const WebSocket = require("ws");
const mongoose = require("mongoose");
const express = require("express");
const http = require("http");
const path = require("path");
require("dotenv").config();
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const User = require('./models/User');
const auth = require('./middleware/auth');

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 30000 })
  .then(() => console.log("Connected to MongoDB"))
  .catch((error) => {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  });

// Define schemas and models
const sensorSchema = new mongoose.Schema(
  {
    temperature: Number,
    humidity: Number,
    pressure: Number,
    distance: Number,
    timestamp: { type: Date, default: Date.now },
  },
  { strict: false }
);

const cameraSchema = new mongoose.Schema(
  {
    type: String,
    ip: String,
    status: String,
    timestamp: { type: Date, default: Date.now },
  },
  { strict: false }
);

const SensorData = mongoose.model("SensorData", sensorSchema, "sensordatas");
const CameraData = mongoose.model("CameraData", cameraSchema, "cameradata");

// Variable to track camera status
let cameraStatus = "offline"; // Default to offline
let cameraTimeout; // To track the timeout for camera status

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Express app setup
const app = express();
const sensorServer = http.createServer(app);
const cameraServer = http.createServer(app);

// Serve static files, including index.html
app.use(express.static(path.join(__dirname, "public")));
// Add these to your existing Express setup
app.use(express.json());
app.use(cookieParser());

// Instead, serve specific static files/folders as needed
app.use('/styles', express.static(path.join(__dirname, "public/styles")));
app.use('/scripts', express.static(path.join(__dirname, "public/scripts")));
app.use('/images', express.static(path.join(__dirname, "public/images")));

// Add a route to serve `camera.html`
app.get("/camera", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "camera.html"));
});

// Add API route to fetch all sensor data
app.get("/api/all-sensor-data", async (req, res) => {
  try {
    const data = await SensorData.find().sort({ timestamp: 1 });
    res.json(data);
  } catch (err) {
    console.error("Error fetching sensor data:", err);
    res.status(500).send("Error fetching sensor data");
  }
});

// Add API route to fetch the latest camera data
app.get("/api/latest-camera-data", async (req, res) => {
  try {
    const latestCameraData = await CameraData.findOne().sort({ timestamp: -1 }); // Fetch the most recent camera data
    res.json(latestCameraData || { type: "camera", ip: "N/A", status: "offline" }); // Default response if no data
  } catch (err) {
    console.error("Error fetching camera data:", err);
    res.status(500).send("Error fetching camera data");
  }
});

// Add API route to fetch user thresholds
app.get('/api/user-thresholds', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    res.json(user.thresholds || {});
  } catch (err) {
    console.error('Error fetching user thresholds:', err);
    res.status(500).send('Error fetching user thresholds');
  }
});

// Function to check thresholds and send notifications
async function checkThresholdsAndNotify(sensorData, userId) {
  try {
    const user = await User.findById(userId);
    if (!user || !user.thresholds) return;

    const notifications = [];

    // Check temperature
    if (user.thresholds.temperature) {
      if (sensorData.temperature < user.thresholds.temperature.min ||
        sensorData.temperature > user.thresholds.temperature.max) {
        notifications.push(`Temperature (${sensorData.temperature}°C) is outside the set range (${user.thresholds.temperature.min}°C - ${user.thresholds.temperature.max}°C)`);
      }
    }

    // Check humidity
    if (user.thresholds.humidity) {
      if (sensorData.humidity < user.thresholds.humidity.min ||
        sensorData.humidity > user.thresholds.humidity.max) {
        notifications.push(`Humidity (${sensorData.humidity}%) is outside the set range (${user.thresholds.humidity.min}% - ${user.thresholds.humidity.max}%)`);
      }
    }

    // Check pressure
    if (user.thresholds.pressure) {
      if (sensorData.pressure < user.thresholds.pressure.min ||
        sensorData.pressure > user.thresholds.pressure.max) {
        notifications.push(`Pressure (${sensorData.pressure}hPa) is outside the set range (${user.thresholds.pressure.min}hPa - ${user.thresholds.pressure.max}hPa)`);
      }
    }

    // Check distance
    if (user.thresholds.distance) {
      if (sensorData.distance < user.thresholds.distance.min ||
        sensorData.distance > user.thresholds.distance.max) {
        notifications.push(`Distance (${sensorData.distance}cm) is outside the set range (${user.thresholds.distance.min}cm - ${user.thresholds.distance.max}cm)`);
      }
    }

    // Send email if there are any notifications
    if (notifications.length > 0) {
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'IoT Fermenter Alert: Ambient conditions have changed',
        text: `Hello ${user.fullName},\n\n` +
          `Your ${user.fermentationTitle} fermentation process has the following alerts:\n\n` +
          notifications.join('\n') + '\n\n' +
          'Please check your fermentation conditions.\n\n' +
          'Best regards,\nIoT Fermenter Team'
      };

      await transporter.sendMail(mailOptions);
      console.log('Notification email sent to:', user.email);
    }
  } catch (error) {
    console.error('Error in threshold checking:', error);
  }
}

// WebSocket servers
const sensorWSS = new WebSocket.Server({ server: sensorServer });
const cameraWSS = new WebSocket.Server({ server: cameraServer });

console.log("WebSocket servers started");

// Broadcast new data to all connected WebSocket clients
function broadcastToClients(wss, data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Handle WebSocket messages from ESP32 sensors
sensorWSS.on('connection', (ws) => {
  console.log('ESP32 connected');

  ws.on('message', async (message) => {
    try {
      const parsedMessage = JSON.parse(message.toString());
      console.log('Received from ESP32:', parsedMessage);

      // Add timestamp and save to MongoDB
      const sensorData = new SensorData({
        ...parsedMessage,
        timestamp: parsedMessage.timestamp || new Date(),
      });
      const savedData = await sensorData.save();
      console.log('Sensor data saved to MongoDB');

      // Check thresholds for all users
      const users = await User.find({});
      for (const user of users) {
        await checkThresholdsAndNotify(savedData, user._id);
      }

      // Broadcast new sensor data to clients
      broadcastToClients(sensorWSS, { type: 'new', data: savedData });
    } catch (err) {
      console.error('Error processing sensor data:', err);
    }
  });

  ws.on('close', () => {
    console.log('ESP32 disconnected');
  });
});

// Handle WebSocket messages from ESP32 cameras
cameraWSS.on("connection", (ws) => {
  console.log("ESP32 camera connected");

  // Set camera status to online
  cameraStatus = "online";
  console.log(`Camera status: ${cameraStatus}`);

  ws.on("message", async (message) => {
    try {
      const parsedMessage = JSON.parse(message.toString());
      console.log("Received from camera:", parsedMessage);

      // Add timestamp and save to MongoDB
      const cameraData = new CameraData({
        ...parsedMessage,
        timestamp: parsedMessage.timestamp || new Date(),
      });
      const savedData = await cameraData.save();
      console.log("Camera data saved to MongoDB");

      // Reset camera timeout on each message
      clearTimeout(cameraTimeout);
      cameraTimeout = setTimeout(() => {
        cameraStatus = "offline"; // Mark camera as offline after timeout
        console.log(`Camera status: ${cameraStatus}`);
      }, 10000); // Set timeout for 10 seconds

      // Optionally broadcast new camera data to clients
      broadcastToClients(cameraWSS, { type: "new", data: savedData });
    } catch (err) {
      console.error("Error processing camera data:", err);
    }
  });

  ws.on("close", () => {
    console.log("Camera ESP32 disconnected");
    clearTimeout(cameraTimeout);
    cameraStatus = "offline";
    console.log(`Camera status: ${cameraStatus}`);
  });
});

// Start servers
sensorServer.listen(process.env.SENSOR_PORT || 3000, () => {
  console.log(`Sensor server running at http://localhost:${process.env.SENSOR_PORT || 3000}`);
});

cameraServer.listen(process.env.CAMERA_PORT || 3001, () => {
  console.log(`Camera server running at http://localhost:${process.env.CAMERA_PORT || 3001}`);
});



// Authentication routes
app.post('/auth/signup', async (req, res) => {
  try {
    const { 
      email, 
      password, 
      fullName,
      fermentationTitle,
      thresholds
    } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).send('User already exists');
    }

    // Create new user with thresholds
    const user = new User({
      email,
      password,
      fullName,
      fermentationTitle,
      thresholds: {
        temperature: thresholds?.temperature || { min: null, max: null },
        humidity: thresholds?.humidity || { min: null, max: null },
        pressure: thresholds?.pressure || { min: null, max: null },
        distance: thresholds?.distance || { min: null, max: null }
      }
    });

    await user.save();
    
    // Create token for immediate login after signup
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    
    // Set cookie and send response
    res.cookie('token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }); // 24 hours
    res.status(201).json({
      message: 'User created successfully',
      user: {
        fullName: user.fullName,
        email: user.email,
        fermentationTitle: user.fermentationTitle,
        thresholds: user.thresholds
      }
    });
  } catch (error) {
    res.status(500).send('Error creating user');
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).send('Invalid credentials');
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).send('Invalid credentials');
    }

    // Create token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    // Send user's name along with success message
    res.json({
      message: 'Logged in successfully',
      userName: user.fullName
    });
  } catch (error) {
    res.status(500).send('Error logging in');
  }
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.send('Logged out successfully');
});

// Update your existing routes to use auth middleware
app.get('/', auth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

app.get('/camera', auth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'camera.html'));
});

// Add login and signup routes
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// Protect your API routes
app.get('/api/all-sensor-data', auth, async (req, res) => {
  try {
    const data = await SensorData.find().sort({ timestamp: 1 });
    res.json(data);
  } catch (err) {
    console.error("Error fetching sensor data:", err);
    res.status(500).send("Error fetching sensor data");
  }
});

app.get('/api/latest-camera-data', auth, async (req, res) => {
  try {
    const latestCameraData = await CameraData.findOne().sort({ timestamp: -1 }); // Fetch the most recent camera data
    res.json(latestCameraData || { type: "camera", ip: "N/A", status: "offline" }); // Default response if no data
  } catch (err) {
    console.error("Error fetching camera data:", err);
    res.status(500).send("Error fetching camera data");
  }
});

app.listen(3989, () => {
  console.log(`Server running at http://localhost:${3989}`);
});