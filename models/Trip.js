const mongoose = require("mongoose");
const tripStopMediaSchema = new mongoose.Schema({
  storageKey: {
    type: String,
    required: true,
  },
  thumbnailKey: { type: String, trim: true },
  durationSeconds: { type: Number, min: 0 },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
  caption: {
    type: String,
    trim: true,
    maxlength: 200,
    default: "",
  },
});

const tripStopSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 150,
  },
  type: {
    type: String,
    enum: ["city", "airport", "attraction", "region", "custom"],
    required: true,
  },
  city: {
    type: String,
    trim: true,
    default: "",
  },
  state: {
    type: String,
    trim: true,
    default: "",
  },
  country: {
    type: String,
    trim: true,
    default: "",
  },
  airportCode: {
    type: String,
    uppercase: true,
    trim: true,
    default: "",
    match: /^[A-Z0-9]{3}$|^$/,
  },
  order: {
    type: Number,
    default: 0,
    min: 0,
  },
  photos: {
    type: [tripStopMediaSchema],
    default: [],
  },
  videos: {
    type: [tripStopMediaSchema],
    default: [],
  },
});

const tripSchema = new mongoose.Schema(
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
      maxlength: 100,
    },

    // Legacy field — keep for existing trips
    destinationCode: {
      type: String,
      uppercase: true,
      trim: true,
      default: "",
      match: /^[A-Z0-9]{3}$|^$/,
    },

    // Legacy destinations — preserve existing airport codes
    destinations: {
      type: [
        {
          type: String,
          uppercase: true,
          trim: true,
          match: /^[A-Z0-9]{3}$/,
        },
      ],
      default: [],
    },

    // Flexible trip destinations
    tripStops: {
      type: [tripStopSchema],
      default: [],
    },

    // IDs of curated places the traveler saved for this trip.
    savedIdeas: {
      type: [
        {
          type: String,
          trim: true,
          maxlength: 100,
        },
      ],
      default: [],
    },

    startDate: {
      type: Date,
      default: null,
    },

    endDate: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    coverImage: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2048,
    },
  },
  { timestamps: true },
);

tripSchema.path("endDate").validate(function (endDate) {
  if (!endDate || !this.startDate) return true;

  return endDate >= this.startDate;
}, "End date cannot be before start date.");

module.exports = mongoose.model("Trip", tripSchema);
