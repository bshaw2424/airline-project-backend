const express = require("express");
const mongoose = require("mongoose");
const Trip = require("../models/Trip");

const router = express.Router();

const MAX_TRIPS_PER_USER = 200;
const MAX_DESTINATIONS_PER_TRIP = 50;

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
    } = req.body;

    // Validate trip name
    if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
      return res.status(400).json({
        message: "Trip name must be between 1 and 100 characters.",
      });
    }

    // Legacy primary airport code remains optional
    const code =
      typeof destinationCode === "string"
        ? destinationCode.trim().toUpperCase()
        : "";

    if (destinationCode != null && typeof destinationCode !== "string") {
      return res.status(400).json({
        message: "Invalid airport code.",
      });
    }

    if (code && !/^[A-Z0-9]{3}$/.test(code)) {
      return res.status(400).json({
        message: "Airport code must contain three characters.",
      });
    }

    // Validate notes
    if (typeof notes !== "string" || notes.length > 1000) {
      return res.status(400).json({
        message: "Notes cannot exceed 1000 characters.",
      });
    }

    // Validate cover image URL
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

    // Parse and validate dates
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

    // Check user's trip limit
    const tripCount = await Trip.countDocuments({
      user: req.session.userId,
    });

    if (tripCount >= MAX_TRIPS_PER_USER) {
      return res.status(409).json({
        message: `You have reached the maximum of ${MAX_TRIPS_PER_USER} trips.`,
      });
    }

    // Create trip
    const trip = await Trip.create({
      user: req.session.userId,
      name: name.trim(),
      destinationCode: code,
      tripStops: [],
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      notes: notes.trim(),
      coverImage: normalizedCoverImage,
    });

    return res.status(201).json({
      message: "Trip created successfully.",
      trip,
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

// Remove flexible destination
router.delete("/:id/stops/:stopId", async (req, res) => {
  try {
    const { id, stopId } = req.params;

    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(stopId)) {
      return res.status(400).json({
        message: "Invalid trip or destination ID.",
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

    const stop = trip.tripStops.id(stopId);

    if (!stop) {
      return res.status(404).json({
        message: "Destination not found.",
      });
    }

    // Remove selected stop.
    trip.tripStops.pull({
      _id: stopId,
    });

    // Sort remaining stops using their existing order.
    trip.tripStops.sort((a, b) => a.order - b.order);

    // Reassign sequential order values.
    trip.tripStops.forEach((stop, index) => {
      stop.order = index;
    });

    await trip.save();

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

    const orderMap = new Map(stopIds.map((stopId, index) => [stopId, index]));

    trip.tripStops.forEach(stop => {
      stop.order = orderMap.get(stop._id.toString());
    });

    trip.tripStops.sort((a, b) => a.order - b.order);

    await trip.save();

    return res.status(200).json({
      message: "Trip itinerary reordered successfully.",
      trip,
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
