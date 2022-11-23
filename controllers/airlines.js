const Airlines = require("../models/airlines");

module.exports.index = async (req, res) => {
  const airlines = await Airlines.find();
  res.render("airlines/index", { airlines });
};

module.exports.newAirline = async (req, res) => {
  res.render("airlines/new");
};

module.exports.post = async (req, res) => {
  const { Airline } = req.body;
  const newAirline = new Airlines(Airline);
  await newAirline.save();
  res.redirect("/airlines");
};

module.exports.showPage = async (req, res) => {
  const { slug } = req.params;
  const showPage = await Airlines.findOne({ slug });
  const destinations = await Airlines.findOne({ slug }).populate(
    "destinations",
  );
  res.render("airlines/showPage", { showPage, destinations });
};

module.exports.edit = async (req, res) => {
  const { slug } = req.params;
  const airlines = await Airlines.findOne({ slug: slug });
  res.render("airlines/edit", { airlines });
};

module.exports.update = async (req, res) => {
  const { slug } = req.params;
  const { Airline } = req.body;
  const airline = await Airlines.findOneAndUpdate(
    {
      slug: slug,
    },
    { ...Airline },
    {
      new: true,
    },
  );
  await airline.save();
  res.redirect("/airlines");
};

module.exports.delete = async (req, res) => {
  const { slug } = req.params;
  await Airlines.findOneAndDelete({ slug: slug });
  res.redirect("/airlines");
};
