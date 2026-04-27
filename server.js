const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve all static files from current directory
app.use(express.static(__dirname));

// Serve index.html on root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ EdgeMafia Neural AI running on port ${PORT}`);
    console.log(`📍 Open http://localhost:${PORT} or your Render URL`);
});