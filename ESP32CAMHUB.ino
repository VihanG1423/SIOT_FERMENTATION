#define CAMERA_MODEL_AI_THINKER

#include "esp_camera.h"
#include <WiFi.h>
#include <WebSocketsClient.h>
#include "camera_pins.h"

// Wi-Fi credentials
const char *ssid = " ";
const char *password = " ";

// WebSocket server configuration
WebSocketsClient webSocket;
const char* webSocketServer = " ";
const int webSocketPort = 3001; // Node.js WebSocket server port

// Function to handle WebSocket events
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  // Retrieve the camera's IP address
  String camIP = WiFi.localIP().toString();

  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("WebSocket disconnected");
      break;

    case WStype_CONNECTED:
      Serial.println("WebSocket connected");
      // Send the camera's IP address upon connection
      webSocket.sendTXT("{\"type\":\"camera\",\"ip\":\"" + camIP + "\",\"status\":\"online\"}");
      break;

    case WStype_TEXT:
      Serial.printf("WebSocket message received: %s\n", payload);
      break;
  }
}

// Camera server initialization function
void startCameraServer();

// Setup function
void setup() {
  Serial.begin(115200);
  Serial.println();

  // Camera initialization
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_UXGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.jpeg_quality = 10;
  config.fb_count = 2;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x", err);
    return;
  }

  // Wi-Fi connection
  WiFi.begin(ssid, password);
  WiFi.setSleep(false);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected");

  // Start the camera server
  startCameraServer();

  // Initialize WebSocket connection
  webSocket.begin(webSocketServer, webSocketPort, "/");
  webSocket.onEvent(webSocketEvent);

  // Send initial camera status
  String camIP = WiFi.localIP().toString();
  Serial.println("Camera Ready! IP: " + camIP);
  webSocket.sendTXT("{\"type\":\"camera\",\"ip\":\"" + camIP + "\",\"status\":\"online\"}");
}

// Loop function
void loop() {
  webSocket.loop();

  // Periodically send camera status
  static unsigned long lastStatusTime = 0;
  if (millis() - lastStatusTime > 10000) { // Every 10 seconds
    String camIP = WiFi.localIP().toString();
    webSocket.sendTXT("{\"type\":\"camera\", \"ip\":\"" + camIP + "\",  \"status\":\"online\" }");
    lastStatusTime = millis();
  }

  // Check and reconnect Wi-Fi if disconnected
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
  }
}
