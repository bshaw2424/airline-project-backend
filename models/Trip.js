const mongoose = require("mongoose");

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

    destinationCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      match: /^[A-Z0-9]{3}$/,
    },

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
  },
  {
    timestamps: true,
  },
);

tripSchema.path("endDate").validate(function (endDate) {
  if (!endDate || !this.startDate) return true;

  return endDate >= this.startDate;
}, "End date cannot be before start date.");

module.exports = mongoose.model("Trip", tripSchema);
