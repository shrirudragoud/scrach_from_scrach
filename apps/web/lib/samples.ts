import type { ProjectFile } from '@codeblocks/core';

export interface Sample {
  label: string;
  main: string;
  files: ProjectFile[];
}

const one = (label: string, name: string, content: string): Sample => ({ label, main: name, files: [{ name, content }] });

export const SAMPLES: Record<string, Sample> = {
  'blink': one("💡 Blink a light", 'blink.ino', "// Blink: turn a light on and off, again and again\n#define LED_PIN 13\n\nvoid setup() {\n  pinMode(LED_PIN, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(LED_PIN, HIGH);\n  delay(1000);\n  digitalWrite(LED_PIN, LOW);\n  delay(1000);\n}\n"),
  'button-led': one("🔘 Button toggles a light", 'button-led.ino', "const int buttonPin = 2;\nconst int ledPin = 13;\nint lastState = LOW;\nint ledState = LOW;\n\nvoid setup() {\n  pinMode(buttonPin, INPUT_PULLUP);\n  pinMode(ledPin, OUTPUT);\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  int reading = digitalRead(buttonPin);\n  if (reading == LOW && lastState == HIGH) {\n    ledState = !ledState;\n    digitalWrite(ledPin, ledState);\n    Serial.println(\"Toggled\");\n    delay(50); // debounce\n  }\n  lastState = reading;\n}\n"),
  'servo-sweep': one("🦾 Robot arm sweep", 'servo-sweep.ino', "#include <Servo.h>\n\nServo myServo;\nint pos = 0;\n\nvoid setup() {\n  myServo.attach(9);\n}\n\nvoid loop() {\n  for (pos = 0; pos <= 180; pos += 1) {\n    myServo.write(pos);\n    delay(15);\n  }\n  for (pos = 180; pos >= 0; pos -= 1) {\n    myServo.write(pos);\n    delay(15);\n  }\n}\n"),
  'traffic-light': one("🚦 Traffic light", 'traffic-light.ino', "// A little traffic light that counts down before it changes\nconst int redLed = 10;\nconst int yellowLed = 11;\nconst int greenLed = 12;\n\nvoid setup() {\n  pinMode(redLed, OUTPUT);\n  pinMode(yellowLed, OUTPUT);\n  pinMode(greenLed, OUTPUT);\n}\n\nvoid blinkYellow(int times) {\n  for (int i = 0; i < times; i++) {\n    digitalWrite(yellowLed, HIGH);\n    delay(300);\n    digitalWrite(yellowLed, LOW);\n    delay(300);\n  }\n}\n\nvoid loop() {\n  digitalWrite(redLed, HIGH);\n  delay(3000);\n  digitalWrite(redLed, LOW);\n\n  blinkYellow(3);\n\n  digitalWrite(greenLed, HIGH);\n  delay(3000);\n  digitalWrite(greenLed, LOW);\n}\n"),
  'parking-sensor': one("🚗 Parking sensor (advanced)", 'parking-sensor.ino', "#include <Servo.h>\n\n#define TRIG 7\n#define ECHO 8\n#define BUZZER 6\nconst int resetBtn = 2;\nconst int ledRed = 10;\nconst int ledGreen = 11;\nvolatile bool reset = false;\nint mode = 0;\nServo gate;\n\nvoid onReset() {\n  reset = true;\n}\n\nlong readDistanceCm() {\n  digitalWrite(TRIG, LOW);\n  delayMicroseconds(2);\n  digitalWrite(TRIG, HIGH);\n  delayMicroseconds(10);\n  digitalWrite(TRIG, LOW);\n  long duration = pulseIn(ECHO, HIGH);\n  return duration / 58;\n}\n\nvoid alarm(int times) {\n  for (int i = 0; i < times; i++) {\n    tone(BUZZER, 1000);\n    delay(100);\n    noTone(BUZZER);\n    delay(100);\n  }\n}\n\nvoid setup() {\n  pinMode(TRIG, OUTPUT);\n  pinMode(ECHO, INPUT);\n  pinMode(BUZZER, OUTPUT);\n  pinMode(ledRed, OUTPUT);\n  pinMode(ledGreen, OUTPUT);\n  pinMode(resetBtn, INPUT_PULLUP);\n  Serial.begin(115200);\n  gate.attach(9);\n  attachInterrupt(digitalPinToInterrupt(resetBtn), onReset, FALLING);\n}\n\nvoid loop() {\n  if (reset) {\n    mode = 0;\n    reset = false;\n    Serial.println(\"Reset\");\n  }\n\n  long d = readDistanceCm();\n  Serial.println(d);\n\n  switch (mode) {\n    case 0:\n      if (d < 30) {\n        mode = 1;\n        gate.write(90);\n      }\n      break;\n    case 1:\n    case 2:\n      digitalWrite(ledRed, HIGH);\n      digitalWrite(ledGreen, LOW);\n      alarm(3);\n      if (d > 60) {\n        mode = 0;\n        gate.write(0);\n        break;\n      }\n      mode = 2;\n      break;\n    default:\n      mode = 0;\n  }\n\n  while (d < 5) {\n    d = readDistanceCm();\n    if (d < 2) {\n      Serial.println(\"Too close!\");\n      break;\n    }\n    delay(20);\n  }\n  delay(100);\n}\n"),
  'traffic-tabs': {
    label: '🚦 Traffic light (3 tabs)',
    main: 'traffic.ino',
    files: [
      {
        name: 'traffic.ino',
        content: `// Main tab: runs the lights in order.
void setup() {
  setupLights();
}

void loop() {
  showRed();
  showGreen();
  blinkYellow(3);
}
`,
      },
      {
        name: 'lights.ino',
        content: `// Tab 2: one block per light colour.
const int redLed = 10;
const int yellowLed = 11;
const int greenLed = 12;

void setupLights() {
  pinMode(redLed, OUTPUT);
  pinMode(yellowLed, OUTPUT);
  pinMode(greenLed, OUTPUT);
}

void showRed() {
  digitalWrite(redLed, HIGH);
  waitSeconds(3);
  digitalWrite(redLed, LOW);
}

void showGreen() {
  digitalWrite(greenLed, HIGH);
  waitSeconds(3);
  digitalWrite(greenLed, LOW);
}
`,
      },
      {
        name: 'timing.ino',
        content: `// Tab 3: helpers for waiting and blinking.
void waitSeconds(int s) {
  delay(s * 1000);
}

void blinkYellow(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(yellowLed, HIGH);
    delay(300);
    digitalWrite(yellowLed, LOW);
    delay(300);
  }
}
`,
      },
    ],
  },
};

export const DEFAULT_SAMPLE = 'traffic-tabs';
