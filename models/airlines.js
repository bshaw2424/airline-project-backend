const { Schema, model } = require("mongoose");

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
  fees_policy: {
    type: String,
  },
  slug: {
    type: String,
  },
  destinations: [{ type: Schema.Types.ObjectId, ref: "Destination" }],
});

airlineSchema.pre("save", function (next) {
  this.slug = slugify(this.title, {
    lower: true,
  });
  next();
});

module.exports = model("Airline", airlineSchema);
