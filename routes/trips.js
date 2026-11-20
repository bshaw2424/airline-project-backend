const express = require("express");
const mongoose = require("mongoose");
const Trip = require("../models/Trip");
const User = require("../models/User");
const tripIdeas = require("../data/tripIdeas");
const { randomUUID } = require("node:crypto");
const multer = require("multer");
const sharp = require("sharp");
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { execFile } = require("node:child_process");
const { createReadStream } = require("node:fs");
const { mkdtemp, rm, stat } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { extname, join } = require("node:path");
const { promisify } = require("node:util");

const runMediaCommand = promisify(execFile);

const router = express.Router();

const MAX_TRIPS_PER_USER = 200;
const MAX_DESTINATIONS_PER_TRIP = 50;
const MAX_PHOTOS_PER_STOP = 10;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_VIDEOS_PER_STOP = 3;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 30;

const uploadStopPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 0 },
}).single("photo");

const spaces = new S3Client({
  endpoint: process.env.SPACES_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: false,
  credentials: {
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
  },
});

// --------------------------------------------------
// AUTHENTICATION
// --------------------------------------------------

const requireAuth = (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({
      message: "Please log in to manage your trips.",
    });
  }

  next();
};

router.use(requireAuth);

// List photos for a stop on a trip owned by the signed-in user.
router.get("/:id/stops/:stopId/photos", async (req, res) => {
  const { id, stopId } = req.params;

  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(stopId)) {
    return res.status(400).json({
      message: "Invalid trip or destination ID.",
    });
  }

  try {
    const trip = await Trip.findOne({
      _id: id,
      user: req.session.userId,
      "tripStops._id": stopId,
    }).select("tripStops");

    const stop = trip?.tripStops.id(stopId);

    if (!stop) {
      return res.status(404).json({
        message: "Trip or destination not found.",
      });
    }

    // Sign each private object only after confirming trip ownership.
    const photos = await Promise.all(
      (stop.photos ?? []).map(async photo => ({
        _id: photo._id,
        uploadedAt: photo.uploadedAt,
        caption: photo.caption ?? "",
        url: await getSignedUrl(
          spaces,
          new GetObjectCommand({
            Bucket: process.env.SPACES_BUCKET,
            Key: photo.storageKey,
            ResponseCacheControl: "private, no-store",
          }),
          { expiresIn: 300 },
        ),
      })),
    );

    res.set("Cache-Control", "private, no-store");
    return res.status(200).json({ photos });
  } catch (error) {
    console.error("List trip stop photos error:", error.name);
    return res.status(500).json({
      message: "Unable to load destination photos.",
    });
  }
});

// List videos for a stop on a trip owned by the signed-in user.
router.get("/:id/stops/:stopId/videos", async (req, res) => {
  const { id, stopId } = req.params;

  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(stopId)) {
    return res.status(400).json({
      message: "Invalid trip or destination ID.",
    });
  }

  try {
    const trip = await Trip.findOne({
      _id: id,
      user: req.session.userId,
      "tripStops._id": stopId,
    }).select("tripStops");

    const stop = trip?.tripStops.id(stopId);

    if (!stop) {
      return res.status(404).json({
        message: "Trip or destination not found.",
      });
    }

    const videos = await Promise.all(
      (stop.videos ?? []).map(async video => ({
        _id: video._id,
        uploadedAt: video.uploadedAt,
        caption: video.caption ?? "",
        url: await getSignedUrl(
          spaces,
          new GetObjectCommand({
            Bucket: process.env.SPACES_BUCKET,
            Key: video.storageKey,
            ResponseCacheControl: "private, no-store",
          }),
          { expiresIn: 300 },
        ),
      })),
    );

    res.set("Cache-Control", "private, no-store");
    return res.status(200).json({ videos });
  } catch (error) {
    console.error("List trip stop videos error:", error.name);
    return res.status(500).json({
      message: "Unable to load destination videos.",
    });
  }
});

// Save or clear a caption on a photo or video in a trip the user owns.
router.patch(
  "/:id/stops/:stopId/:mediaType/:mediaId/caption",
  async (req, res) => {
    const { id, stopId, mediaType, mediaId } = req.params;

    // Only allow the two media arrays defined in the trip schema.
    if (mediaType !== "photos" && mediaType !== "videos") {
      return res.status(404).json({ message: "Media type not found." });
    }

    if (![id, stopId, mediaId].every(value => /^[a-f\d]{24}$/i.test(value))) {
      return res.status(400).json({
        message: "Invalid trip, destination, or media ID.",
      });
    }

    const rawCaption = req.body?.caption;

    if (typeof rawCaption !== "string") {
      return res.status(400).json({ message: "Caption must be text." });
    }

    // An empty string clears the saved caption.
    const caption = rawCaption.trim();

    if (caption.length > 200) {
      return res.status(400).json({
        message: "Caption must be 200 characters or fewer.",
      });
    }

    try {
      const stopObjectId = new mongoose.Types.ObjectId(stopId);
      const mediaObjectId = new mongoose.Types.ObjectId(mediaId);

      // Match the owned trip and update only the requested item on this stop.
      const result = await Trip.updateOne(
        {
          _id: id,
          user: req.session.userId,
          tripStops: {
            $elemMatch: {
              _id: stopObjectId,
              [`${mediaType}._id`]: mediaObjectId,
            },
          },
        },
        {
          $set: {
            [`tripStops.$[stop].${mediaType}.$[media].caption`]: caption,
          },
        },
        {
          arrayFilters: [
            { "stop._id": stopObjectId },
            { "media._id": mediaObjectId },
          ],
          runValidators: true,
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          message: "Trip, destination, or media item not found.",
        });
      }

      return res.status(200).json({ caption });
    } catch (error) {
      console.error("Update trip stop media caption error:", error.name);
      return res.status(500).json({
        message: "Unable to save the caption.",
      });
    }
  },
);

// Delete one photo or video from a stop on a trip the user owns.
router.delete("/:id/stops/:stopId/:mediaType/:mediaId", async (req, res) => {
  const { id, stopId, mediaType, mediaId } = req.params;

  // Only allow the two media arrays defined in the trip schema.
  if (mediaType !== "photos" && mediaType !== "videos") {
    return res.status(404).json({ message: "Media type not found." });
  }

  if (![id, stopId, mediaId].every(value => /^[a-f\d]{24}$/i.test(value))) {
    return res.status(400).json({
      message: "Invalid trip, destination, or media ID.",
    });
  }

  try {
    const stopObjectId = new mongoose.Types.ObjectId(stopId);
    const mediaObjectId = new mongoose.Types.ObjectId(mediaId);

    // Remove the item and keep its previous record for Spaces cleanup.
    const previousTrip = await Trip.findOneAndUpdate(
      {
        _id: id,
        user: req.session.userId,
        tripStops: {
          $elemMatch: {
            _id: stopObjectId,
            [`${mediaType}._id`]: mediaObjectId,
          },
        },
      },
      {
        $pull: { [`tripStops.$.${mediaType}`]: { _id: mediaObjectId } },
      },
      { new: false },
    ).select("tripStops");

    if (!previousTrip) {
      return res.status(404).json({
        message: "Trip, destination, or media item not found.",
      });
    }

    const items = previousTrip.tripStops.id(stopId)[mediaType];
    const item = items.id(mediaId);

    // Log a Spaces cleanup failure the same way stop deletion does.
    try {
      await spaces.send(
        new DeleteObjectCommand({
          Bucket: process.env.SPACES_BUCKET,
          Key: item.storageKey,
        }),
      );
    } catch (error) {
      console.error("Media cleanup failed:", item.storageKey, error.name);
    }

    // Keep the existing photo response and mirror it for videos.
    const remainingCount = items.length - 1;
    return res
      .status(200)
      .json(
        mediaType === "photos"
          ? { photoId: mediaId, photoCount: remainingCount }
          : { videoId: mediaId, videoCount: remainingCount },
      );
  } catch (error) {
    console.error("Delete trip stop media error:", error.name);
    return res.status(500).json({ message: "Unable to delete this item." });
  }
});

// Upload a photo to a stop on a trip the user owns.
router.post("/:id/stops/:stopId/photos", async (req, res) => {
  const { id, stopId } = req.params;

  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(stopId)) {
    return res.status(400).json({
      message: "Invalid trip or destination ID.",
    });
  }

  const photoLimitField = `photos.${MAX_PHOTOS_PER_STOP - 1}`;
  const eligibleStopFilter = {
    _id: id,
    user: req.session.userId,
    tripStops: {
      $elemMatch: {
        _id: stopId,
        [photoLimitField]: { $exists: false },
      },
    },
  };

  const uploadStartedAt = performance.now();
  let previousStepAt = uploadStartedAt;
  const timings = {};

  const recordStep = step => {
    const now = performance.now();
    timings[step] = Math.round(now - previousStepAt);
    previousStepAt = now;
  };

  try {
    const trip = await Trip.findOne({
      _id: id,
      user: req.session.userId,
      "tripStops._id": stopId,
    }).select("tripStops");
    recordStep("tripLookupMs");

    const stop = trip?.tripStops.id(stopId);

    if (!stop) {
      return res
        .status(404)
        .json({ message: "Trip or destination not found." });
    }

    if (stop.photos.length >= MAX_PHOTOS_PER_STOP) {
      return res.status(409).json({
        message: `A destination can have up to ${MAX_PHOTOS_PER_STOP} photos.`,
      });
    }

    await new Promise((resolve, reject) => {
      uploadStopPhoto(req, res, error => {
        if (error) reject(error);
        else resolve();
      });
    });
    recordStep("receivePhotoMs");

    if (!req.file) {
      return res.status(400).json({ message: "Choose a photo to upload." });
    }

    let photoBuffer;

    try {
      const image = sharp(req.file.buffer, { limitInputPixels: 40_000_000 });
      const { format } = await image.metadata();

      if (!["jpeg", "png", "webp"].includes(format)) {
        return res
          .status(400)
          .json({ message: "Choose a JPEG, PNG, or WebP image." });
      }

      photoBuffer = await image
        .rotate()
        .resize({
          width: 2000,
          height: 2000,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch {
      return res.status(400).json({ message: "Unable to read this image." });
    }
    recordStep("processPhotoMs");

    const storageKey = `trip-photos/${id}/${stopId}/${randomUUID()}.jpg`;
    const object = {
      Bucket: process.env.SPACES_BUCKET,
      Key: storageKey,
    };

    await spaces.send(
      new PutObjectCommand({
        ...object,
        Body: photoBuffer,
        ContentType: "image/jpeg",
        ACL: "private",
      }),
    );

    recordStep("spacesUploadMs");

    // Check the limit again in the update so simultaneous uploads respect it.
    const updatedTrip = await Trip.findOneAndUpdate(
      eligibleStopFilter,
      {
        $push: { "tripStops.$.photos": { storageKey, uploadedAt: new Date() } },
      },
      { new: true, runValidators: true },
    );

    recordStep("savePhotoMs");

    if (!updatedTrip) {
      await spaces.send(new DeleteObjectCommand(object));
      return res.status(409).json({
        message: "The destination was removed or has reached its photo limit.",
      });
    }

    console.info("Trip stop photo upload timing:", {
      ...timings,
      totalMs: Math.round(performance.now() - uploadStartedAt),
      inputBytes: req.file.size,
      outputBytes: photoBuffer.length,
    });

    return res.status(201).json({
      message: "Photo added successfully.",
      trip: updatedTrip,
    });
  } catch (error) {
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({
        message: tooLarge
          ? "Choose a photo under 5 MiB."
          : "Upload one photo at a time.",
      });
    }

    console.error("Upload trip stop photo error:", error.name);
    return res.status(500).json({ message: "Unable to upload the photo." });
  }
});

// Convert a short clip and attach it to a stop on a trip the user owns.
router.post("/:id/stops/:stopId/videos", async (req, res) => {
  const { id, stopId } = req.params;

  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(stopId)) {
    return res.status(400).json({
      message: "Invalid trip or destination ID.",
    });
  }

  const tripFilter = { _id: id, user: req.session.userId };
  let tempDirectory;

  try {
    const trip = await Trip.findOne({
      ...tripFilter,
      "tripStops._id": stopId,
    }).select("tripStops");

    const stop = trip?.tripStops.id(stopId);

    if (!stop) {
      return res
        .status(404)
        .json({ message: "Trip or destination not found." });
    }

    if ((stop.videos?.length ?? 0) >= MAX_VIDEOS_PER_STOP) {
      return res.status(409).json({
        message: `A destination can have up to ${MAX_VIDEOS_PER_STOP} videos.`,
      });
    }

    // Save incoming clips to disk while FFmpeg inspects and converts them.
    tempDirectory = await mkdtemp(join(tmpdir(), "flightinrange-video-"));

    const uploadVideo = multer({
      dest: tempDirectory,
      limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 0 },
    }).single("video");

    await new Promise((resolve, reject) => {
      uploadVideo(req, res, error => {
        if (error) reject(error);
        else resolve();
      });
    });

    const extension = extname(req.file?.originalname ?? "").toLowerCase();

    if (!req.file || ![".mp4", ".mov"].includes(extension)) {
      return res.status(400).json({ message: "Choose an MP4 or MOV clip." });
    }

    const inputArgs = [
      "-protocol_whitelist",
      "file",
      "-f",
      "mov",
      "-i",
      req.file.path,
    ];
    const outputPath = join(tempDirectory, "output.mp4");

    try {
      // Require a video stream and validate the clip duration.
      const { stdout } = await runMediaCommand(
        "ffprobe",
        [
          "-v",
          "error",
          ...inputArgs,
          "-select_streams",
          "V:0",
          "-show_entries",
          "stream=index:format=duration",
          "-of",
          "json",
        ],
        { timeout: 10_000, windowsHide: true },
      );

      const metadata = JSON.parse(stdout);
      const duration = Number(metadata.format?.duration);

      if (
        !metadata.streams?.length ||
        !Number.isFinite(duration) ||
        duration <= 0
      ) {
        return res.status(400).json({ message: "Unable to read this video." });
      }

      if (duration > MAX_VIDEO_SECONDS) {
        return res.status(400).json({
          message: `Choose a clip that is ${MAX_VIDEO_SECONDS} seconds or shorter.`,
        });
      }

      await runMediaCommand(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          ...inputArgs,
          "-map",
          "0:V:0",
          "-map",
          "0:a:0?",
          "-t",
          String(MAX_VIDEO_SECONDS),
          "-vf",
          "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-map_metadata",
          "-1",
          "-movflags",
          "+faststart",
          outputPath,
        ],
        { timeout: 90_000, windowsHide: true },
      );
    } catch (error) {
      if (error.code === "ENOENT") throw error;

      return res.status(422).json({
        message: "Unable to process this clip. Try a shorter MP4 or MOV video.",
      });
    }

    // Store the converted MP4 privately before attaching it to the stop.
    const storageKey = `trip-videos/${id}/${stopId}/${randomUUID()}.mp4`;
    const object = { Bucket: process.env.SPACES_BUCKET, Key: storageKey };
    const { size } = await stat(outputPath);

    await spaces.send(
      new PutObjectCommand({
        ...object,
        Body: createReadStream(outputPath),
        ContentLength: size,
        ContentType: "video/mp4",
        ACL: "private",
      }),
    );

    // Recheck the limit in MongoDB so concurrent uploads respect it.
    const videoLimitField = `videos.${MAX_VIDEOS_PER_STOP - 1}`;
    const updatedTrip = await Trip.findOneAndUpdate(
      {
        ...tripFilter,
        tripStops: {
          $elemMatch: {
            _id: stopId,
            [videoLimitField]: { $exists: false },
          },
        },
      },
      {
        $push: { "tripStops.$.videos": { storageKey, uploadedAt: new Date() } },
      },
      { new: true, runValidators: true },
    );

    if (!updatedTrip) {
      await spaces.send(new DeleteObjectCommand(object));
      return res.status(409).json({
        message: "The destination was removed or has reached its video limit.",
      });
    }

    return res.status(201).json({
      message: "Video added successfully.",
      trip: updatedTrip,
    });
  } catch (error) {
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({
        message: tooLarge
          ? "Choose a video that is 25 MiB or smaller."
          : "Upload one video at a time.",
      });
    }

    console.error(
      "Upload trip stop video error:",
      error.name,
      error.code,
      error.message,
    );
    return res.status(500).json({ message: "Unable to upload the video." });
  } finally {
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true }).catch(error => {
        console.error("Video temporary file cleanup failed:", error.code);
      });
    }
  }
});

// --------------------------------------------------
// CREATE TRIP
// POST /api/trips
// --------------------------------------------------

router.post("/", async (req, res) => {
  try {
    const {
      name,
      destinationCode,
      startDate,
      endDate,
      notes = "",
      coverImage = "",
    } = req.body ?? {};

    if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
      return res.status(400).json({
        message: "Trip name must be between 1 and 100 characters.",
      });
    }

    if (destinationCode != null && typeof destinationCode !== "string") {
      return res.status(400).json({
        message: "Invalid airport code.",
      });
    }

    const code =
      typeof destinationCode === "string"
        ? destinationCode.trim().toUpperCase()
        : "";

    if (code && !/^[A-Z0-9]{3}$/.test(code)) {
      return res.status(400).json({
        message: "Airport code must contain three characters.",
      });
    }

    if (typeof notes !== "string" || notes.length > 1000) {
      return res.status(400).json({
        message: "Notes cannot exceed 1000 characters.",
      });
    }

    if (typeof coverImage !== "string" || coverImage.length > 2048) {
      return res.status(400).json({
        message: "Invalid trip cover image.",
      });
    }

    const normalizedCoverImage = coverImage.trim();

    if (normalizedCoverImage) {
      try {
        const imageUrl = new URL(normalizedCoverImage);

        if (!["https:", "http:"].includes(imageUrl.protocol)) {
          return res.status(400).json({
            message: "Cover image must use HTTP or HTTPS.",
          });
        }
      } catch {
        return res.status(400).json({
          message: "Please provide a valid cover image URL.",
        });
      }
    }

    const parseDate = value => {
      if (value == null || value === "") return null;

      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return undefined;
      }

      const date = new Date(`${value}T00:00:00.000Z`);

      return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
        ? date
        : undefined;
    };

    const parsedStartDate = parseDate(startDate);
    const parsedEndDate = parseDate(endDate);

    if (parsedStartDate === undefined || parsedEndDate === undefined) {
      return res.status(400).json({
        message: "Please provide valid dates in YYYY-MM-DD format.",
      });
    }

    if (parsedStartDate && parsedEndDate && parsedEndDate < parsedStartDate) {
      return res.status(400).json({
        message: "End date cannot be before start date.",
      });
    }

    const userId = req.session.userId;

    const result = await User.withActiveAccount(
      userId,
      req.session.sessionVersion ?? 0,
      async session => {
        const tripCount = await Trip.countDocuments({
          user: userId,
        }).session(session);

        if (tripCount >= MAX_TRIPS_PER_USER) {
          return { limitReached: true };
        }

        const trip = new Trip({
          user: userId,
          name: name.trim(),
          destinationCode: code,
          tripStops: [],
          startDate: parsedStartDate,
          endDate: parsedEndDate,
          notes: notes.trim(),
          coverImage: normalizedCoverImage,
        });

        await trip.save({ session });
        return { trip };
      },
    );

    if (!result) {
      return res.status(401).json({
        message: "Please log in to manage your trips.",
      });
    }

    if (result.limitReached) {
      return res.status(409).json({
        message: `You have reached the maximum of ${MAX_TRIPS_PER_USER} trips.`,
      });
    }

    return res.status(201).json({
      message: "Trip created successfully.",
      trip: result.trip,
    });
  } catch (error) {
    console.error("Create trip error:", error);

    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({
        message: "Invalid trip information.",
      });
    }

    return res.status(500).json({
      message: "Unable to create trip.",
    });
  }
});

// --------------------------------------------------
// GET ALL TRIPS
// --------------------------------------------------

router.get("/", async (req, res) => {
  try {
    const trips = await Trip.find({
      user: req.session.userId,
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      trips,
    });
  } catch (error) {
    console.error("Get trips error:", error);

    return res.status(500).json({
      message: "Unable to retrieve trips.",
    });
  }
});

// --------------------------------------------------
// GET SINGLE TRIP
// --------------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid trip ID.",
      });
    }

    const trip = await Trip.findOne({
      _id: id,
      user: req.session.userId,
    });

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found.",
      });
    }

    return res.status(200).json({
      trip,
    });
  } catch (error) {
    console.error("Get single trip error:", error);

    return res.status(500).json({
      message: "Unable to retrieve trip.",
    });
  }
});

// --------------------------------------------------
// TRIP IDEA RECOMMENDATIONS
// --------------------------------------------------
router.post("/:id/ideas", async (req, res) => {
  const { id } = req.params;
  const { ideaId } = req.body ?? {};

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid trip ID." });
  }

  if (typeof ideaId !== "string" || !tripIdeas.has(ideaId)) {
    return res.status(400).json({ message: "Choose a valid trip idea." });
  }

  try {
    const trip = await Trip.findOneAndUpdate(
      { _id: id, user: req.session.userId },
      { $addToSet: { savedIdeas: ideaId } },
      { new: true, runValidators: true, projection: { savedIdeas: 1 } },
    );

    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    return res.status(200).json({ savedIdeas: trip.savedIdeas });
  } catch (error) {
    console.error("Save trip idea error:", error);
    return res.status(500).json({ message: "Unable to save trip idea." });
  }
});

router.post("/:id/ideas/:ideaId/move", async (req, res) => {
  const { id, ideaId } = req.params;
  const idea = tripIdeas.get(ideaId);

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ message: "Invalid trip ID." });
  }

  if (!idea) {
    return res.status(400).json({ message: "Choose a valid trip idea." });
  }

  const ownerFilter = { _id: id, user: req.session.userId };

  try {
    const trip = await Trip.findOne(ownerFilter)
      .select("savedIdeas tripStops.order destinations")
      .lean();

    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    if (!(trip.savedIdeas ?? []).includes(ideaId)) {
      return res.status(409).json({ message: "This idea is no longer saved." });
    }

    const stops = trip.tripStops ?? [];
    const totalStops = stops.length + (trip.destinations?.length ?? 0);

    if (totalStops >= MAX_DESTINATIONS_PER_TRIP) {
      return res.status(409).json({
        message: `Maximum of ${MAX_DESTINATIONS_PER_TRIP} destinations reached.`,
      });
    }

    const lastOrder = stops.length
      ? Math.max(...stops.map(stop => stop.order ?? 0))
      : -1;

    const updatedTrip = await Trip.findOneAndUpdate(
      {
        ...ownerFilter,
        savedIdeas: ideaId,
        $expr: {
          $and: [
            {
              $lt: [
                {
                  $add: [
                    { $size: { $ifNull: ["$tripStops", []] } },
                    { $size: { $ifNull: ["$destinations", []] } },
                  ],
                },
                MAX_DESTINATIONS_PER_TRIP,
              ],
            },
            {
              $eq: [{ $ifNull: [{ $max: "$tripStops.order" }, -1] }, lastOrder],
            },
          ],
        },
      },
      {
        $push: {
          tripStops: {
            name: idea.name,
            type: idea.category === "Beaches" ? "custom" : "attraction",
            city: "San Diego",
            state: "California",
            country: "United States",
            order: lastOrder + 1,
          },
        },
        $pull: { savedIdeas: ideaId },
      },
      { new: true, runValidators: true },
    );

    if (!updatedTrip) {
      return res.status(409).json({
        message: "The trip changed. Refresh it and try again.",
      });
    }

    return res.status(201).json({ trip: updatedTrip });
  } catch (error) {
    console.error("Move trip idea error:", error);
    return res.status(500).json({ message: "Unable to move this idea." });
  }
});

// --------------------------------------------------
// LEGACY DESTINATIONS
// --------------------------------------------------

// Add legacy airport-code destination
router.post("/:id/destinations", async (req, res) => {
  try {
    const { id } = req.params;
    const { airportCode } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid trip ID.",
      });
    }

    if (
      typeof airportCode !== "string" ||
      !/^[A-Za-z0-9]{3}$/.test(airportCode)
    ) {
      return res.status(400).json({
        message: "A valid three-character airport code is required.",
      });
    }

    const code = airportCode.toUpperCase();

    const trip = await Trip.findOneAndUpdate(
      {
        _id: id,
        user: req.session.userId,
        $or: [
          {
            destinations: code,
          },
          {
            $expr: {
              $lt: [
                {
                  $size: {
                    $ifNull: ["$destinations", []],
                  },
                },
                MAX_DESTINATIONS_PER_TRIP,
              ],
            },
          },
        ],
      },
      {
        $addToSet: {
          destinations: code,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!trip) {
      const existingTrip = await Trip.exists({
        _id: id,
        user: req.session.userId,
      });

      if (!existingTrip) {
        return res.status(404).json({
          message: "Trip not found.",
        });
      }

      return res.status(409).json({
        message: `Maximum of ${MAX_DESTINATIONS_PER_TRIP} destinations reached.`,
      });
    }

    return res.status(200).json({
      message: "Destination added to trip successfully.",
      trip,
    });
  } catch (error) {
    console.error("Add trip destination error:", error);

    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({
        message: "Invalid destination.",
      });
    }

    return res.status(500).json({
      message: "Unable to add destination to trip.",
    });
  }
});

// Remove legacy airport-code destination
router.delete("/:id/destinations/:airportCode", async (req, res) => {
  try {
    const { id, airportCode } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid trip ID.",
      });
    }

    if (!/^[A-Za-z0-9]{3}$/.test(airportCode)) {
      return res.status(400).json({
        message: "Invalid airport code.",
      });
    }

    const code = airportCode.toUpperCase();

    const trip = await Trip.findOneAndUpdate(
      {
        _id: id,
        user: req.session.userId,
      },
      {
        $pull: {
          destinations: code,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found.",
      });
    }

    return res.status(200).json({
      message: "Destination removed from trip successfully.",
      trip,
    });
  } catch (error) {
    console.error("Remove trip destination error:", error);

    return res.status(500).json({
      message: "Unable to remove destination from trip.",
    });
  }
});

// --------------------------------------------------
// FLEXIBLE TRIP STOPS
// --------------------------------------------------

// Add flexible destination
router.post("/:id/stops", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      type,
      city = "",
      state = "",
      country = "",
      airportCode = "",
    } = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid trip ID.",
      });
    }

    const allowedTypes = ["city", "airport", "attraction", "region", "custom"];

    if (typeof name !== "string" || !name.trim() || name.trim().length > 150) {
      return res.status(400).json({
        message: "Destination name must be between 1 and 150 characters.",
      });
    }

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        message: "Invalid destination type.",
      });
    }

    const locationFields = [city, state, country];

    if (
      locationFields.some(
        value => typeof value !== "string" || value.length > 150,
      )
    ) {
      return res.status(400).json({
        message: "Invalid destination location.",
      });
    }

    if (typeof airportCode !== "string") {
      return res.status(400).json({
        message: "Invalid airport code.",
      });
    }

    const code = airportCode.trim().toUpperCase();

    if (code && !/^[A-Z0-9]{3}$/.test(code)) {
      return res.status(400).json({
        message: "Airport code must contain three characters.",
      });
    }

    const trip = await Trip.findOne({
      _id: id,
      user: req.session.userId,
    });

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found.",
      });
    }

    const totalDestinations =
      (trip.tripStops?.length || 0) + (trip.destinations?.length || 0);

    if (totalDestinations >= MAX_DESTINATIONS_PER_TRIP) {
      return res.status(409).json({
        message: `Maximum of ${MAX_DESTINATIONS_PER_TRIP} destinations reached.`,
      });
    }

    // Find the next available order without modifying
    // the existing itinerary.
    const nextOrder =
      trip.tripStops.length === 0
        ? 0
        : Math.max(...trip.tripStops.map(stop => stop.order)) + 1;

    trip.tripStops.push({
      name: name.trim(),
      type,
      city: city.trim(),
      state: state.trim(),
      country: country.trim(),
      airportCode: code,
      order: nextOrder,
    });

    await trip.save();

    return res.status(201).json({
      message: "Destination added to trip successfully.",
      trip,
    });
  } catch (error) {
    console.error("Add trip stop error:", error);

    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({
        message: "Invalid destination information.",
      });
    }

    return res.status(500).json({
      message: "Unable to add destination to trip.",
    });
  }
});

// update stop
router.patch("/:id/stops/:stopId", async (req, res) => {
  try {
    const { id, stopId } = req.params;

    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(stopId)) {
      return res.status(400).json({
        message: "Invalid trip or destination ID.",
      });
    }

    const { name, type, city, state, country, airportCode } = req.body || {};
    const updates = {};

    if (name !== undefined) {
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.trim().length > 150
      ) {
        return res.status(400).json({
          message: "Destination name must be between 1 and 150 characters.",
        });
      }

      updates["tripStops.$.name"] = name.trim();
    }

    if (type !== undefined) {
      const allowedTypes = [
        "city",
        "airport",
        "attraction",
        "region",
        "custom",
      ];

      if (!allowedTypes.includes(type)) {
        return res.status(400).json({
          message: "Invalid destination type.",
        });
      }

      updates["tripStops.$.type"] = type;
    }

    for (const [field, value] of Object.entries({ city, state, country })) {
      if (value === undefined) continue;

      if (typeof value !== "string" || value.length > 150) {
        return res.status(400).json({
          message: "Invalid destination location.",
        });
      }

      updates[`tripStops.$.${field}`] = value.trim();
    }

    if (airportCode !== undefined) {
      if (typeof airportCode !== "string") {
        return res.status(400).json({
          message: "Invalid airport code.",
        });
      }

      const code = airportCode.trim().toUpperCase();

      if (code && !/^[A-Z0-9]{3}$/.test(code)) {
        return res.status(400).json({
          message: "Airport code must contain three characters.",
        });
      }

      updates["tripStops.$.airportCode"] = code;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: "Provide at least one destination field to update.",
      });
    }

    const trip = await Trip.findOneAndUpdate(
      {
        _id: id,
        user: req.session.userId,
        "tripStops._id": stopId,
      },
      { $set: updates },
      { new: true, runValidators: true },
    );

    if (!trip) {
      return res.status(404).json({
        message: "Trip or destination not found.",
      });
    }

    return res.json({
      message: "Destination updated successfully.",
      trip,
    });
  } catch (error) {
    console.error("Update trip stop error:", error);

    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({
        message: "Invalid destination information.",
      });
    }

    return res.status(500).json({
      message: "Unable to update destination.",
    });
  }
});

// Remove a flexible destination and clean up its photos.
router.delete("/:id/stops/:stopId", async (req, res) => {
  try {
    const { id, stopId } = req.params;

    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(stopId)) {
      return res.status(400).json({
        message: "Invalid trip or destination ID.",
      });
    }

    // Remove only the matching stop and capture its photo keys before removal.
    const previousTrip = await Trip.findOneAndUpdate(
      {
        _id: id,
        user: req.session.userId,
        "tripStops._id": stopId,
      },
      { $pull: { tripStops: { _id: stopId } } },
      { new: false },
    );

    if (!previousTrip) {
      return res.status(404).json({
        message: "Trip or destination not found.",
      });
    }

    const removedStop = previousTrip.tripStops.id(stopId);
    // Clean up photos and videos attached to the removed stop.
    const media = [
      ...(removedStop?.photos ?? []),
      ...(removedStop?.videos ?? []),
    ];

    // Try every photo deletion and log any failures for later cleanup.
    for (const { storageKey } of media) {
      try {
        await spaces.send(
          new DeleteObjectCommand({
            Bucket: process.env.SPACES_BUCKET,
            Key: storageKey,
          }),
        );
      } catch (error) {
        console.error("Stop photo cleanup failed:", storageKey, error.name);
      }
    }

    // Return the current itinerary to the frontend.
    const trip = await Trip.findOne({
      _id: id,
      user: req.session.userId,
    });

    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    return res.status(200).json({
      message: "Destination removed from trip successfully.",
      trip,
    });
  } catch (error) {
    console.error("Remove trip stop error:", error);

    return res.status(500).json({
      message: "Unable to remove destination from trip.",
    });
  }
});
// --------------------------------------------------
// REORDER FLEXIBLE TRIP STOPS
// PUT /api/trips/:id/stops/reorder
// --------------------------------------------------

router.put("/:id/stops/reorder", async (req, res) => {
  try {
    const { id } = req.params;
    const { stopIds } = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid trip ID.",
      });
    }

    if (
      !Array.isArray(stopIds) ||
      stopIds.length > MAX_DESTINATIONS_PER_TRIP ||
      !stopIds.every(
        stopId =>
          typeof stopId === "string" && mongoose.isValidObjectId(stopId),
      )
    ) {
      return res.status(400).json({
        message: "Invalid destination order.",
      });
    }

    const uniqueIds = new Set(stopIds);

    if (uniqueIds.size !== stopIds.length) {
      return res.status(400).json({
        message: "Duplicate destinations are not allowed.",
      });
    }

    const trip = await Trip.findOne({
      _id: id,
      user: req.session.userId,
    });

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found.",
      });
    }

    const existingIds = new Set(
      trip.tripStops.map(stop => stop._id.toString()),
    );

    if (
      stopIds.length !== trip.tripStops.length ||
      stopIds.some(stopId => !existingIds.has(stopId))
    ) {
      return res.status(400).json({
        message: "Destination order does not match this trip.",
      });
    }

    let updatedTrip = trip;

    if (stopIds.length > 0) {
      const objectIds = stopIds.map(
        stopId => new mongoose.Types.ObjectId(stopId),
      );
      const orderUpdates = {};
      const arrayFilters = [];

      // Update only the order field on each stop, matched by its ID.
      objectIds.forEach((stopId, index) => {
        const alias = `stop${index}`;
        orderUpdates[`tripStops.$[${alias}].order`] = index;
        arrayFilters.push({ [`${alias}._id`]: stopId });
      });

      updatedTrip = await Trip.findOneAndUpdate(
        {
          _id: id,
          user: req.session.userId,
          // Recheck membership in case a stop was added or removed.
          tripStops: { $size: objectIds.length },
          "tripStops._id": { $all: objectIds },
        },
        { $set: orderUpdates },
        { arrayFilters, new: true, runValidators: true },
      );

      if (!updatedTrip) {
        return res.status(409).json({
          message: "The itinerary changed. Refresh the trip and try again.",
        });
      }
    }
    return res.status(200).json({
      message: "Trip itinerary reordered successfully.",
      trip: updatedTrip,
    });
  } catch (error) {
    console.error("Reorder trip stops error:", error);

    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({
        message: "Invalid destination order.",
      });
    }

    return res.status(500).json({
      message: "Unable to reorder trip destinations.",
    });
  }
});

// --------------------------------------------------
// UPDATE TRIP
// --------------------------------------------------

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid trip ID.",
      });
    }

    const trip = await Trip.findOne({
      _id: id,
      user: req.session.userId,
    });

    if (!trip) {
      return res.status(404).json({
        message: "Trip not found.",
      });
    }

    const { name, destinationCode, startDate, endDate, notes, coverImage } =
      req.body;

    if (name !== undefined) {
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.trim().length > 100
      ) {
        return res.status(400).json({
          message: "Trip name must be between 1 and 100 characters.",
        });
      }

      trip.name = name.trim();
    }

    // Legacy airport code validation remains for now.
    if (destinationCode !== undefined) {
      if (typeof destinationCode !== "string") {
        return res.status(400).json({
          message: "Invalid airport code.",
        });
      }

      const code = destinationCode.trim().toUpperCase();

      if (code && !/^[A-Z0-9]{3}$/.test(code)) {
        return res.status(400).json({
          message: "Airport code must contain three characters.",
        });
      }

      trip.destinationCode = code;
    }

    if (notes !== undefined) {
      if (typeof notes !== "string" || notes.length > 1000) {
        return res.status(400).json({
          message: "Notes cannot exceed 1000 characters.",
        });
      }

      trip.notes = notes.trim();
    }

    const parseDate = value => {
      if (value === null || value === "") return null;

      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return undefined;
      }

      const date = new Date(`${value}T00:00:00.000Z`);

      return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
        ? date
        : undefined;
    };

    if (startDate !== undefined) {
      const parsed = parseDate(startDate);

      if (parsed === undefined) {
        return res.status(400).json({
          message: "Invalid start date.",
        });
      }

      trip.startDate = parsed;
    }

    if (endDate !== undefined) {
      const parsed = parseDate(endDate);

      if (parsed === undefined) {
        return res.status(400).json({
          message: "Invalid end date.",
        });
      }

      trip.endDate = parsed;
    }

    if (trip.startDate && trip.endDate && trip.endDate < trip.startDate) {
      return res.status(400).json({
        message: "End date cannot be before start date.",
      });
    }

    // Update trip cover image
    if (coverImage !== undefined) {
      if (typeof coverImage !== "string" || coverImage.length > 2048) {
        return res.status(400).json({
          message: "Invalid trip cover image.",
        });
      }

      const normalizedCoverImage = coverImage.trim();

      if (normalizedCoverImage) {
        try {
          const imageUrl = new URL(normalizedCoverImage);

          if (!["https:", "http:"].includes(imageUrl.protocol)) {
            return res.status(400).json({
              message: "Cover image must use HTTP or HTTPS.",
            });
          }
        } catch {
          return res.status(400).json({
            message: "Please provide a valid cover image URL.",
          });
        }
      }

      trip.coverImage = normalizedCoverImage;
    }

    await trip.save();

    return res.status(200).json({
      message: "Trip updated successfully.",
      trip,
    });
  } catch (error) {
    console.error("Update trip error:", error);

    if (error instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({
        message: "Invalid trip information.",
      });
    }

    return res.status(500).json({
      message: "Unable to update trip.",
    });
  }
});

// --------------------------------------------------
// DELETE TRIP
// --------------------------------------------------

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid trip ID.",
      });
    }

    const deletedTrip = await Trip.findOneAndDelete({
      _id: id,
      user: req.session.userId,
    });

    if (!deletedTrip) {
      return res.status(404).json({
        message: "Trip not found.",
      });
    }

    // The deleted trip still contains the photo keys for all its stops.
    for (const stop of deletedTrip.tripStops ?? []) {
      // Clean up both media types for each stop on the deleted trip.
      for (const { storageKey } of [
        ...(stop.photos ?? []),
        ...(stop.videos ?? []),
      ]) {
        try {
          await spaces.send(
            new DeleteObjectCommand({
              Bucket: process.env.SPACES_BUCKET,
              Key: storageKey,
            }),
          );
        } catch (error) {
          // Log the key for later cleanup and continue with the other photos.
          console.error("Trip photo cleanup failed:", storageKey, error.name);
        }
      }
    }

    return res.status(200).json({
      message: "Trip deleted successfully.",
    });
  } catch (error) {
    console.error("Delete trip error:", error);

    return res.status(500).json({
      message: "Unable to delete trip.",
    });
  }
});

module.exports = router;
