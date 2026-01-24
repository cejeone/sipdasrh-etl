require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');


const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// 1. MongoDB Connection & Generic Schema
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('Could not connect to MongoDB', err));

const DataSchema = new mongoose.Schema({
    sheetName: String,
    data: Object,
    uploadedAt: { type: Date, default: Date.now }
});

const ExcelData = mongoose.model('ExcelData', DataSchema);

// 2. Multer Configuration (Rename with Timestamp)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        cb(null, `${timestamp}-${file.originalname}`);
    }
});
const upload = multer({ storage });

// 3. Endpoint: Upload and Parse 3 Sheets
app.post('/upload', upload.single('excelFile'), async (req, res) => {
    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetNames = workbook.SheetNames; // Reads all available sheets

        const savePromises = sheetNames.map(async (name) => {
            const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[name]);
            return new ExcelData({
                sheetName: name,
                data: sheetData
            }).save();
        });

        await Promise.all(savePromises);
        res.status(200).send({ message: "File uploaded and all sheets stored successfully." });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// 4. Endpoint: Return All Data + Latest Entries
app.get('/data', async (req, res) => {
    try {
        const allData = await ExcelData.find().sort({ uploadedAt: -1 });
        
        // Logic to get the latest entry for each unique sheet name
        const latestEntries = await ExcelData.aggregate([
            { $sort: { uploadedAt: -1 } },
            { $group: { _id: "$sheetName", latest: { $first: "$$ROOT" } } }
        ]);

        res.json({
            totalCount: allData.length,
            latestBySheet: latestEntries,
            allEntries: allData
        });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});