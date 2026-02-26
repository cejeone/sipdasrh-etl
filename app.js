require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");
const Consul = require("consul");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const CONSUL_HOST = process.env.CONSUL_HOST || "localhost";
const CONSUL_PORT = process.env.CONSUL_PORT || 8500;
const SERVICE_NAME = "sipdasrh-etl";
const SERVICE_ID = `${SERVICE_NAME}-${PORT}`;

const consul = new Consul({
  host: CONSUL_HOST,
  port: CONSUL_PORT,
});

// Consul Health Check Registration
const registerService = async () => {
    try {
        await consul.agent.service.register({
            id: SERVICE_ID,
            name: SERVICE_NAME,
            address: process.env.SERVICE_ADDRESS || 'localhost',
            port: parseInt(PORT),
            check: {
                http: `http://${process.env.SERVICE_ADDRESS || 'localhost'}:${PORT}/health`,
                interval: '10s',
                timeout: '5s'
            }
        });
        console.log(`Service ${SERVICE_ID} registered with Consul at ${CONSUL_HOST}:${CONSUL_PORT}`);
    } catch (err) {
        console.error('Failed to register service with Consul:', err);
    }
};

const deregisterService = async () => {
    try {
        await consul.agent.service.deregister(SERVICE_ID);
        console.log(`Service ${SERVICE_ID} deregistered from Consul`);
    } catch (err) {
        console.error('Failed to deregister service from Consul:', err);
    }
};


// 1. MongoDB Connection & Generic Schema
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Could not connect to MongoDB", err));

const DataSchema = new mongoose.Schema({
  sheetName: String,
  data: Object,
  uploadedAt: { type: Date, default: Date.now },
});

const ExcelData = mongoose.model("ExcelData", DataSchema);

// 2. Multer Configuration (Rename with Timestamp)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "./uploads";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `${timestamp}-${file.originalname}`);
  },
});
const upload = multer({ storage });

// Consul Health Check Endpoint
app.get("/health", (req, res) => {
  res.status(200).send({ status: "UP" });
});

// 3. Endpoint: Upload and Parse 3 Sheets
app.post("/upload", upload.single("excelFile"), async (req, res) => {
  try {
    const workbook = xlsx.readFile(req.file.path);
    const sheetNames = workbook.SheetNames; // Reads all available sheets

    const savePromises = sheetNames.map(async (name) => {
      const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[name]);
      return new ExcelData({
        sheetName: name,
        data: sheetData,
      }).save();
    });

    await Promise.all(savePromises);
    res
      .status(200)
      .send({ message: "File uploaded and all sheets stored successfully." });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// 4. Endpoint: Return All Data + Latest Entries
app.get("/data", async (req, res) => {
  try {
    const allData = await ExcelData.find().sort({ uploadedAt: -1 });

    // Logic to get the latest entry for each unique sheet name
    const latestEntries = await ExcelData.aggregate([
      { $sort: { uploadedAt: -1 } },
      { $group: { _id: "$sheetName", latest: { $first: "$$ROOT" } } },
    ]);

    res.json({
      totalCount: allData.length,
      latestBySheet: latestEntries,
      allEntries: allData,
    });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  registerService();
});

// Graceful Shutdown
process.on("SIGINT", async () => {
  await deregisterService();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await deregisterService();
  process.exit(0);
});
