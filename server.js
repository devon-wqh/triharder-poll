const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { networkInterfaces } = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

let poll = {
  status: 'setup', // 'setup' | 'open' | 'closed'
  question: '',
  options: [],
  answers: [],
  totalVotes: 0,
  voters: new Set(),
};

function resetPoll() {
  poll = {
    status: 'setup',
    question: '',
    options: [],
    answers: [],
    totalVotes: 0,
    voters: new Set(),
  };
}

function getLocalIP() {
  const nets = networkInterfaces();
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

app.use(express.static('public'));

app.get('/host', (req, res) => res.sendFile('host.html', { root: 'public' }));
app.get('/join', (req, res) => res.sendFile('join.html', { root: 'public' }));

app.get('/api/qr', async (req, res) => {
  const base = process.env.BASE_URL
    || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const url = `${base}/join`;
  try {
    const dataURL = await QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: { dark: '#0f0f1a', light: '#ffffff' },
    });
    res.json({ dataURL, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  // Sync new connections to current state
  socket.emit('state_sync', {
    status: poll.status,
    question: poll.question,
    options: poll.options,
    answers: poll.answers,
    totalVotes: poll.totalVotes,
    hasVoted: poll.voters.has(socket.id),
  });

  socket.on('start_poll', ({ question, options }) => {
    if (!question || !options || options.length < 2) return;

    poll.status = 'open';
    poll.question = question.trim();
    poll.options = options.map((o) => o.trim());
    poll.answers = new Array(options.length).fill(0);
    poll.totalVotes = 0;
    poll.voters = new Set();

    io.emit('poll_started', {
      question: poll.question,
      options: poll.options,
    });
  });

  socket.on('submit_answer', ({ optionIndex }) => {
    if (poll.status !== 'open') return;
    if (poll.voters.has(socket.id)) return;
    if (optionIndex < 0 || optionIndex >= poll.options.length) return;

    poll.voters.add(socket.id);
    poll.answers[optionIndex]++;
    poll.totalVotes++;

    socket.emit('vote_accepted');

    io.emit('vote_update', {
      answers: poll.answers,
      totalVotes: poll.totalVotes,
    });
  });

  socket.on('close_poll', () => {
    if (poll.status !== 'open') return;
    poll.status = 'closed';

    io.emit('poll_closed', {
      question: poll.question,
      options: poll.options,
      answers: poll.answers,
      totalVotes: poll.totalVotes,
    });
  });

  socket.on('reset_poll', () => {
    resetPoll();
    io.emit('poll_reset');
  });
});

server.listen(PORT, () => {
  const ip = getLocalIP();
  console.log(`\n  Poll server running!`);
  console.log(`  Host screen → http://localhost:${PORT}/host`);
  console.log(`  Join URL    → http://${ip}:${PORT}/join`);
  console.log(`  (share the QR code shown on the host screen)\n`);
});
