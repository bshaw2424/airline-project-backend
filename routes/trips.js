const express = require("express");
const mongoose = require("mongoose");
const Trip = require("../models/Trip");

const router = express.Router();

// Require a logged-in user
const requireAuth = (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({
      message: "Please log in to manage your trips.",
    });
  }

  next();
};

router.use(requireAuth);

// POST /api/trips - Create a new trip
router.post("/", async (req, res) => {
  try {
    const { name, destinationCode, startDate, endDate, notes = "" } = req.body;

    if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
      return res.status(400).json({
        message: "Trip name must be between 1 and 100 characters.",
      });
    }

    if (
      typeof destinationCode !== "string" ||
      !/^[A-Za-z0-9]{3}$/.test(destinationCode)
    ) {
      return res.status(400).json({
        message: "A valid three-character airport code is required.",
      });
    }

    if (typeof notes !== "string" || notes.length > 1000) {
      return res.status(400).json({
        message: "Notes cannot exceed 1000 characters.",
      });
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

    const trip = await Trip.create({
      user: req.session.userId,
      name: name.trim(),
      destinationCode: destinationCode.toUpperCase(),
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      notes: notes.trim(),
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

// GET /api/trips - Retrieve the logged-in user's trips
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

// GET /api/trips/:id - Retrieve a single trip
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

    return res.status(200).json({ trip });
  } catch (error) {
    console.error("Get single trip error:", error);

    return res.status(500).json({
      message: "Unable to retrieve trip.",
    });
  }
});

// POST /api/trips/:id/destinations
// Add a destination to an existing trip
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
      return res.status(404).json({
        message: "Trip not found.",
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

// DELETE /api/trips/:id/destinations/:airportCode
// Remove a destination from a trip
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

// PUT /api/trips/:id - Update an existing trip
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

    const { name, destinationCode, startDate, endDate, notes } = req.body;

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

    if (destinationCode !== undefined) {
      if (
        typeof destinationCode !== "string" ||
        !/^[A-Za-z0-9]{3}$/.test(destinationCode)
      ) {
        return res.status(400).json({
          message: "A valid three-character airport code is required.",
        });
      }

      trip.destinationCode = destinationCode.toUpperCase();
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

// DELETE /api/trips/:id - Delete a trip
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
