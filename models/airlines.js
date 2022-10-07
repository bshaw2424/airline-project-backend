const { Schema, model } = require("mongoose");
const slugify = require("slugify");
const Destination = require("./destinations");

const airlineSchema = new Schema({
  name: {
    type: String,
    unique: true,
  },
  logo: {
    type: String,
  },
  website: {
    type: String,
    unique: true,
  },
  slug: {
    type: String,
  },
  destinations: [{ type: Schema.Types.ObjectId, ref: "Destination" }],
});

airlineSchema.pre("save", function (next) {
  this.slug = slugify(this.name, {
    lower: true,
  });
  next();
});

module.exports = model("Airline", airlineSchema);
