const express = require("express");
const Feedback = require("../models/Feedback");
const { rateLimit } = require("express-rate-limit");

const router = express.Router();
const categories = new Set(["bug", "suggestion", "general"]);

// Limit feedback submission attempts from the same IP address.
const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many feedback submissions. Please try again later.",
  },
});

router.post("/", feedbackLimiter, async (req, res) => {
  const { category, message } = req.body ?? {};

  // Validate the category and message before saving.
  if (!categories.has(category)) {
    return res.status(400).json({
      message: "Choose Bug report, Suggestion, or General feedback.",
    });
  }

  const trimmedMessage = typeof message === "string" ? message.trim() : "";

  if (!trimmedMessage || trimmedMessage.length > 2000) {
    return res.status(400).json({
      message: "Enter a message between 1 and 2,000 characters.",
    });
  }

  try {
    // Use the session to identify signed-in users. Guests can submit too.
    await Feedback.create({
      user: req.session?.userId ?? null,
      category,
      message: trimmedMessage,
    });

    return res.status(201).json({
      message: "Thank you for your feedback.",
    });
  } catch (error) {
    console.error("Save feedback error:", error.name);
    return res.status(500).json({
      message: "Unable to save your feedback. Please try again.",
    });
  }
});

module.exports = router;
