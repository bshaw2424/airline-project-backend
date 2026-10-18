const mongoose = require("mongoose");

const placeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    type: {
      type: String,
      enum: ["city", "state", "country", "attraction", "other"],
      required: true,
    },

    city: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },

    state: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },

    country: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
  },
  {
    _id: true,
    timestamps: true,
  },
);

const collectionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    destinations: {
      type: [
        {
          type: String,
          uppercase: true,
          trim: true,
          match: /^[A-Z0-9]{3,4}$/,
        },
      ],
      default: [],
    },

    places: {
      type: [placeSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Collection", collectionSchema);
