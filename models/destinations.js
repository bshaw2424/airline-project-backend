const { Schema, model } = require("mongoose");
const slugify = require("slugify");
const Airline = require("./airlines");

const destinationSchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  slug: {
    type: String,
  },
  city: {
    type: String,
    required: true,
  },
  state: {
    type: String,
    required: true,
  },
  international: {
    type: String,
    enum: ["false", "true"],
    default: "false",
    required: true,
  },
  seasonal: {
    type: String,
    enum: ["false", "true"],
    default: "false",
    required: true,
  },
  airport_name: {
    type: String,
    required: true,
  },
  airport_code: {
    type: String,
    upercase: true,
    maxLength: 3,
    required: true,
  },
  destinations: { type: Schema.Types.ObjectId, ref: "Airline" },
});

destinationSchema.pre("save", function (next) {
  this.slug = slugify(this.name, {
    lower: true,
  });
  next();
});

module.exports = model("Destination", destinationSchema);
