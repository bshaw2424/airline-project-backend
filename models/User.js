const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    savedDestinations: {
      type: [String],
      default: [],
    },

    savedAirlines: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
