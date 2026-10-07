// Runs only after the preceding committed flow proves the target screen.
const response = http.get('http://127.0.0.1:8767/capture/' + SHOT);
if (!response.ok) throw new Error('Native capture was withheld or failed.');
