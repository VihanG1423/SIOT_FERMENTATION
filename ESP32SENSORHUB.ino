#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <WiFi.h>
#include <WebSocketsClient.h>

// Wi-Fi credentials
const char* ssid = " ";
const char* password = "";

const char* websocket_server = " "; // Computer's local IP
const int websocket_port = 3000;    // Node.js WebSocket server port

// BME280 settings
#define I2C_SDA 23
#define I2C_SCL 22
#define BME280_ADDRESS 0x76
Adafruit_BME280 bme;

// Ultrasonic sensor pins
const int trigPin = 12;
const int echoPin = 13;

// GPIO pins for LED strip
const int ledPowerPin = 25; // GPIO25 for 3.3V (HIGH)
const int ledGroundPin = 26; // GPIO26 for GND (LOW)

WebSocketsClient webSocket;

void webSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("WebSocket disconnected");
      break;
    case WStype_CONNECTED:
      Serial.println("WebSocket connected");
      break;
    case WStype_TEXT:
      Serial.printf("WebSocket message received: %s\n", payload);
      break;
  }
}

void setup() {
  Serial.begin(115200);

  // Initialize BME280
  Wire.begin(I2C_SDA, I2C_SCL);
  if (!bme.begin(BME280_ADDRESS)) {
    Serial.println("Could not find BME280 sensor!");
    while (1);
  }

  // Initialize ultrasonic sensor
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);

  // Set up GPIO pins for LED power
  pinMode(ledPowerPin, OUTPUT);
  pinMode(ledGroundPin, OUTPUT);

  // Set GPIO25 to HIGH (3.3V) and GPIO26 to LOW (GND)
  digitalWrite(ledPowerPin, HIGH);
  digitalWrite(ledGroundPin, LOW);

  // Connect to Wi-Fi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Connecting to Wi-Fi...");
  }
  Serial.println("Connected to Wi-Fi");

  // Connect to WebSocket server
  webSocket.begin(websocket_server, websocket_port, "/");
  webSocket.onEvent(webSocketEvent);
}

void loop() {
  webSocket.loop();

  if (webSocket.isConnected()) {
    // Read BME280 sensor data
    float temperature = bme.readTemperature();
    float humidity = bme.readHumidity();
    float pressure = bme.readPressure() / 100.0F;

    // Read ultrasonic sensor data
    digitalWrite(trigPin, LOW);
    delayMicroseconds(2);
    digitalWrite(trigPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPin, LOW);
    float ultrasonicDistance = pulseIn(echoPin, HIGH) * 0.034 / 2;

    // Adjust distance based on the column height (15cm)
    float distance = 15.0 - ultrasonicDistance; // Adjusted distance

    // Ensure distance does not go below 0 or above the column height
    if (distance < 0) distance = 0;
    if (distance > 15.0) distance = 15.0;

    // Prepare JSON payload
    String payload = String("{\"type\":\"Sensors\",\"temperature\":") + temperature +
                     ",\"humidity\":" + humidity +
                     ",\"pressure\":" + pressure +
                     ",\"distance\":" + distance + "}";

    // Log payload to Serial Monitor
    Serial.println("Sending payload: " + payload);

    // Send data to WebSocket server
    webSocket.sendTXT(payload);

    // Wait before sending the next set of data
    delay(5000); // Send data every 5 seconds
  } else {
    Serial.println("WebSocket not connected, retrying...");
  } 
}
