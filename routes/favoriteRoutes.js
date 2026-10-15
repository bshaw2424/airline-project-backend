"use strict";

const express = require("express");
const User = require("../models/User");

const router = express.Router();

// Require a logged-in user
const requireAuth = (req, res, next) => {
  if (!req.session?.userId) {
    return res.status(401).json({
      message: "Please log in to save destinations.",
    });
  }

  next();
};

// GET /api/favorites/destinations
router.get("/destinations", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);

    if (!user) {
      return res.status(401).json({
        message: "User not found.",
      });
    }

    res.json({
      savedDestinations: user.savedDestinations,
    });
  } catch (error) {
    console.error("Error fetching favorites:", error);

    res.status(500).json({
      message: "Unable to fetch saved destinations.",
    });
  }
});

// POST /api/favorites/destinations
router.post("/destinations", requireAuth, async (req, res) => {
  try {
    const { airportCode } = req.body;

    if (
      typeof airportCode !== "string" ||
      !/^[A-Za-z0-9]{3}$/.test(airportCode)
    ) {
      return res.status(400).json({
        message: "A valid airport code is required.",
      });
    }

    const code = airportCode.toUpperCase();

    const user = await User.findByIdAndUpdate(
      req.session.userId,
      { $addToSet: { savedDestinations: code } },
      { new: true },
    );

    if (!user) {
      return res.status(401).json({
        message: "User not found.",
      });
    }

    res.json({
      savedDestinations: user.savedDestinations,
    });
  } catch (error) {
    console.error("Error saving destination:", error);

    res.status(500).json({
      message: "Unable to save destination.",
    });
  }
});

// DELETE /api/favorites/destinations/:airportCode
router.delete("/destinations/:airportCode", requireAuth, async (req, res) => {
  try {
    const code = req.params.airportCode.toUpperCase();

    if (!/^[A-Z0-9]{3}$/.test(code)) {
      return res.status(400).json({
        message: "Invalid airport code.",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.session.userId,
      { $pull: { savedDestinations: code } },
      { new: true },
    );

    if (!user) {
      return res.status(401).json({
        message: "User not found.",
      });
    }

    res.json({
      savedDestinations: user.savedDestinations,
    });
  } catch (error) {
    console.error("Error removing destination:", error);

    res.status(500).json({
      message: "Unable to remove destination.",
    });
  }
});

const isValidSlug = slug =>
  typeof slug === "string" && /^[a-z0-9_-]+$/.test(slug) && slug.length <= 100;

// GET saved airlines
router.get("/airlines", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);

    if (!user) {
      return res.status(401).json({
        message: "User not found.",
      });
    }

    res.json({
      savedAirlines: user.savedAirlines,
    });
  } catch (error) {
    console.error("Error fetching saved airlines:", error);

    res.status(500).json({
      message: "Unable to fetch saved airlines.",
    });
  }
});

// Save an airline
router.post("/airlines", requireAuth, async (req, res) => {
  try {
    const { airlineSlug } = req.body;

    if (!isValidSlug(airlineSlug)) {
      return res.status(400).json({
        message: "A valid airline slug is required.",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.session.userId,
      {
        $addToSet: {
          savedAirlines: airlineSlug,
        },
      },
      { new: true },
    );

    if (!user) {
      return res.status(401).json({
        message: "User not found.",
      });
    }

    res.json({
      savedAirlines: user.savedAirlines,
    });
  } catch (error) {
    console.error("Error saving airline:", error);

    res.status(500).json({
      message: "Unable to save airline.",
    });
  }
});

// Remove a saved airline
router.delete("/airlines/:airlineSlug", requireAuth, async (req, res) => {
  try {
    const { airlineSlug } = req.params;

    if (!isValidSlug(airlineSlug)) {
      return res.status(400).json({
        message: "Invalid airline slug.",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.session.userId,
      {
        $pull: {
          savedAirlines: airlineSlug,
        },
      },
      { new: true },
    );

    if (!user) {
      return res.status(401).json({
        message: "User not found.",
      });
    }

    res.json({
      savedAirlines: user.savedAirlines,
    });
  } catch (error) {
    console.error("Error removing saved airline:", error);

    res.status(500).json({
      message: "Unable to remove saved airline.",
    });
  }
});

module.exports = router;
