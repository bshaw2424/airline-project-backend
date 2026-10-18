const express = require("express");
const mongoose = require("mongoose");
const MAX_COLLECTIONS_PER_USER = 50;
const MAX_DESTINATIONS_PER_COLLECTION = 200;
const MAX_PLACES_PER_COLLECTION = 200;

const Collection = require("../models/Collections");

const router = express.Router();

// Require an authenticated session
const requireAuth = (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({
      message: "Please log in to manage collections.",
    });
  }

  next();
};

router.use(requireAuth);

const isValidId = id => mongoose.isValidObjectId(id);

const isValidAirportCode = code =>
  typeof code === "string" && /^[A-Z0-9]{3,4}$/.test(code);

// GET all collections belonging to logged-in user
router.get("/", async (req, res) => {
  try {
    const collections = await Collection.find({
      user: req.session.userId,
    }).sort({ createdAt: -1 });

    res.json({ collections });
  } catch (error) {
    console.error("Get collections error:", error);

    res.status(500).json({
      message: "Unable to load collections.",
    });
  }
});

// POST create a collection
router.post("/", async (req, res) => {
  try {
    const { name, description = "" } = req.body;

    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
      return res.status(400).json({
        message: "Collection name must be 1–80 characters.",
      });
    }

    if (typeof description !== "string" || description.length > 500) {
      return res.status(400).json({
        message: "Description must be 500 characters or fewer.",
      });
    }

    const collectionCount = await Collection.countDocuments({
      user: req.session.userId,
    });

    if (collectionCount >= MAX_COLLECTIONS_PER_USER) {
      return res.status(403).json({
        message: `You have reached the maximum of ${MAX_COLLECTIONS_PER_USER} collections.`,
      });
    }

    const collection = await Collection.create({
      user: req.session.userId,
      name: name.trim(),
      description: description.trim(),
    });

    res.status(201).json({ collection });
  } catch (error) {
    console.error("Create collection error:", error);

    res.status(500).json({
      message: "Unable to create collection.",
    });
  }
});

// GET a specific collection
router.get("/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid collection ID.",
      });
    }

    const collection = await Collection.findOne({
      _id: req.params.id,
      user: req.session.userId,
    });

    if (!collection) {
      return res.status(404).json({
        message: "Collection not found.",
      });
    }

    res.json({ collection });
  } catch (error) {
    console.error("Get collection error:", error);

    res.status(500).json({
      message: "Unable to load collection.",
    });
  }
});

// PATCH update collection name or description
router.patch("/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid collection ID.",
      });
    }

    const updates = {};

    if (req.body.name !== undefined) {
      if (
        typeof req.body.name !== "string" ||
        !req.body.name.trim() ||
        req.body.name.trim().length > 80
      ) {
        return res.status(400).json({
          message: "Collection name must be 1–80 characters.",
        });
      }

      updates.name = req.body.name.trim();
    }

    if (req.body.description !== undefined) {
      if (
        typeof req.body.description !== "string" ||
        req.body.description.length > 500
      ) {
        return res.status(400).json({
          message: "Description must be 500 characters or fewer.",
        });
      }

      updates.description = req.body.description.trim();
    }

    const collection = await Collection.findOneAndUpdate(
      {
        _id: req.params.id,
        user: req.session.userId,
      },
      { $set: updates },
      { new: true, runValidators: true },
    );

    if (!collection) {
      return res.status(404).json({
        message: "Collection not found.",
      });
    }

    res.json({ collection });
  } catch (error) {
    console.error("Update collection error:", error);

    res.status(500).json({
      message: "Unable to update collection.",
    });
  }
});

// DELETE collection
router.delete("/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid collection ID.",
      });
    }

    const collection = await Collection.findOneAndDelete({
      _id: req.params.id,
      user: req.session.userId,
    });

    if (!collection) {
      return res.status(404).json({
        message: "Collection not found.",
      });
    }

    res.json({
      message: "Collection deleted successfully.",
    });
  } catch (error) {
    console.error("Delete collection error:", error);

    res.status(500).json({
      message: "Unable to delete collection.",
    });
  }
});

// PATCH update a custom place in a collection
router.patch("/:id/places/:placeId", async (req, res) => {
  try {
    const { id, placeId } = req.params;

    if (!isValidId(id) || !isValidId(placeId)) {
      return res.status(400).json({
        message: "Invalid collection or place ID.",
      });
    }

    const { name, type, city = "", state = "", country = "" } = req.body || {};

    const allowedTypes = ["city", "state", "country", "attraction", "other"];

    if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
      return res.status(400).json({
        message: "Place name must be 1–120 characters.",
      });
    }

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        message: "Please select a valid place type.",
      });
    }

    if (
      [city, state, country].some(
        value => typeof value !== "string" || value.trim().length > 120,
      )
    ) {
      return res.status(400).json({
        message: "Location fields must be 120 characters or fewer.",
      });
    }

    const normalize = value => value.trim().replace(/\s+/g, " ").toLowerCase();

    const updatedPlace = {
      name: name.trim(),
      type,
      city: city.trim(),
      state: state.trim(),
      country: country.trim(),
    };

    const collection = await Collection.findOne({
      _id: id,
      user: req.session.userId,
    });

    if (!collection) {
      return res.status(404).json({
        message: "Collection not found.",
      });
    }

    const place = collection.places.id(placeId);

    if (!place) {
      return res.status(404).json({
        message: "Place not found.",
      });
    }

    const duplicate = collection.places.some(existingPlace => {
      if (existingPlace._id.toString() === placeId) {
        return false;
      }

      return (
        normalize(existingPlace.name) === normalize(updatedPlace.name) &&
        existingPlace.type === updatedPlace.type &&
        normalize(existingPlace.city || "") === normalize(updatedPlace.city) &&
        normalize(existingPlace.state || "") ===
          normalize(updatedPlace.state) &&
        normalize(existingPlace.country || "") ===
          normalize(updatedPlace.country)
      );
    });

    if (duplicate) {
      return res.status(409).json({
        message: "This place is already in your collection.",
      });
    }

    place.set(updatedPlace);

    await collection.save();

    return res.json({
      message: "Place updated successfully.",
      collection,
    });
  } catch (error) {
    console.error("Update custom place error:", error);

    return res.status(500).json({
      message: "Unable to update place.",
    });
  }
});

// POST add a destination to a collection
router.post("/:id/destinations", async (req, res) => {
  try {
    const { airportCode } = req.body || {};

    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid collection ID.",
      });
    }

    if (!isValidAirportCode(airportCode)) {
      return res.status(400).json({
        message: "A valid airport code is required.",
      });
    }

    const collection = await Collection.findOneAndUpdate(
      {
        _id: req.params.id,
        user: req.session.userId,
        $or: [
          { destinations: airportCode },
          {
            $expr: {
              $lt: [
                {
                  $size: {
                    $ifNull: ["$destinations", []],
                  },
                },
                MAX_DESTINATIONS_PER_COLLECTION,
              ],
            },
          },
        ],
      },
      {
        $addToSet: {
          destinations: airportCode,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!collection) {
      const existingCollection = await Collection.exists({
        _id: req.params.id,
        user: req.session.userId,
      });

      if (!existingCollection) {
        return res.status(404).json({
          message: "Collection not found.",
        });
      }

      return res.status(409).json({
        message: `Maximum of ${MAX_DESTINATIONS_PER_COLLECTION} destinations reached.`,
      });
    }

    return res.status(200).json({
      collection,
    });
  } catch (error) {
    console.error("Add destination error:", error);

    return res.status(500).json({
      message: "Unable to add destination.",
    });
  }
});

// DELETE destination from collection
router.delete("/:id/destinations/:airportCode", async (req, res) => {
  try {
    const { airportCode } = req.params;

    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid collection ID.",
      });
    }

    if (!isValidAirportCode(airportCode)) {
      return res.status(400).json({
        message: "Invalid airport code.",
      });
    }

    const collection = await Collection.findOneAndUpdate(
      {
        _id: req.params.id,
        user: req.session.userId,
      },
      {
        $pull: {
          destinations: airportCode,
        },
      },
      { new: true },
    );

    if (!collection) {
      return res.status(404).json({
        message: "Collection not found.",
      });
    }

    res.json({ collection });
  } catch (error) {
    console.error("Remove destination error:", error);

    res.status(500).json({
      message: "Unable to remove destination.",
    });
  }
});

// POST add a custom place to a collection
router.post("/:id/places", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid collection ID.",
      });
    }

    const { name, type, city = "", state = "", country = "" } = req.body || {};

    const allowedTypes = ["city", "state", "country", "attraction", "other"];

    if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
      return res.status(400).json({
        message: "Place name must be 1–120 characters.",
      });
    }

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        message: "Please select a valid place type.",
      });
    }

    if (
      [city, state, country].some(
        value => typeof value !== "string" || value.trim().length > 120,
      )
    ) {
      return res.status(400).json({
        message: "Location fields must be 120 characters or fewer.",
      });
    }

    const normalize = value => value.trim().replace(/\s+/g, " ").toLowerCase();

    const place = {
      name: name.trim(),
      type,
      city: city.trim(),
      state: state.trim(),
      country: country.trim(),
    };

    const collection = await Collection.findOne({
      _id: req.params.id,
      user: req.session.userId,
    });

    if (!collection) {
      return res.status(404).json({
        message: "Collection not found.",
      });
    }

    const duplicate = collection.places.some(existingPlace => {
      return (
        normalize(existingPlace.name) === normalize(place.name) &&
        existingPlace.type === place.type &&
        normalize(existingPlace.city || "") === normalize(place.city) &&
        normalize(existingPlace.state || "") === normalize(place.state) &&
        normalize(existingPlace.country || "") === normalize(place.country)
      );
    });

    if (duplicate) {
      return res.status(409).json({
        message: "This place is already in your collection.",
      });
    }

    if (collection.places.length >= MAX_PLACES_PER_COLLECTION) {
      return res.status(409).json({
        message: `Maximum of ${MAX_PLACES_PER_COLLECTION} custom places reached.`,
      });
    }

    collection.places.push(place);

    await collection.save();

    return res.status(201).json({
      message: "Place added successfully.",
      collection,
    });
  } catch (error) {
    console.error("Add custom place error:", error);

    return res.status(500).json({
      message: "Unable to add place.",
    });
  }
});

// DELETE remove a custom place from a collection
router.delete("/:id/places/:placeId", async (req, res) => {
  try {
    const { id, placeId } = req.params;

    if (!isValidId(id) || !isValidId(placeId)) {
      return res.status(400).json({
        message: "Invalid collection or place ID.",
      });
    }

    const collection = await Collection.findOneAndUpdate(
      {
        _id: id,
        user: req.session.userId,
        "places._id": new mongoose.Types.ObjectId(placeId),
      },
      {
        $pull: {
          places: {
            _id: new mongoose.Types.ObjectId(placeId),
          },
        },
      },
      { new: true },
    );

    if (!collection) {
      return res.status(404).json({
        message: "Collection or place not found.",
      });
    }

    res.json({
      message: "Place removed successfully.",
      collection,
    });
  } catch (error) {
    console.error("Remove custom place error:", error);

    res.status(500).json({
      message: "Unable to remove place.",
    });
  }
});

module.exports = router;
