const mongoose = require("mongoose");
const { rateLimit } = require("express-rate-limit");

const feedbackSchema = new mongoose.Schema(
  {
    // Link feedback to an account when the visitor is signed in.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Use the same categories in the form and the API.
    category: {
      type: String,
      enum: ["bug", "suggestion", "general"],
      required: true,
    },

    // Store the visitor's message as plain text.
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Feedback", feedbackSchema);
