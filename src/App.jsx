import { useEffect, useRef, useState } from 'react';
import './App.css'

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

const userUUID = crypto.randomUUID();
const protocol = window.location.protocol === "https:" ? "wss" : "ws";
const wsUrl = `${protocol}://${SERVER_URL}/ws/${userUUID}`;

// Language configurations
const LANGUAGE_CONFIGS = {
  spanish: { rows: 4, cols: 6, total: 24 },
  english: { rows: 2, cols: 7, total: 14 },
  portuguese: { rows: 5, cols: 4, total: 20 },
  dutch: { rows: 2, cols: 5, total: 10 },
};

function detectLanguage(wordCount) {
  for (const [lang, config] of Object.entries(LANGUAGE_CONFIGS)) {
    if (config.total === wordCount) {
      return lang;
    }
  }
  return 'spanish'; // default
}

function App() {
  const socketRef = useRef(null);
  const [socketReady, setSocketReady] = useState(false);
  const [showStartModal, setShowStartModal] = useState(true);
  const [bingoCards, setBingoCards] = useState([]);
  console.log(bingoCards)
  const [selectedCardIndex, setSelectedCardIndex] = useState(0);
  const [currentWord, setCurrentWord] = useState('');
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualCardId, setManualCardId] = useState('');

  useEffect(() => {
    if (socketRef.current) return;

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => setSocketReady(true);
    socket.onclose = () => setSocketReady(false);

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!showStartModal && bingoCards.length === 0) {
      setShowLoadModal(true);
    }
  }, [showStartModal, bingoCards.length]);

  function registerUser(formData) {
    if (!socketReady) return;

    socketRef.current.send(
      JSON.stringify({ user: formData.get("name") })
    );

    setShowStartModal(false);
  }

  function parseTxtFile(content) {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];

    const cards = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue; // Need at least ID + one word

      const id = parts[0];
      const words = parts.slice(1);

      if (words.length === 0) continue;

      const language = detectLanguage(words.length);
      cards.push({ id, words, language });
    }

    return cards;
  }

  function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      const newCards = parseTxtFile(content);
      if (newCards.length > 0) {
        setBingoCards([...bingoCards, ...newCards]);
        setShowLoadModal(false);
      }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset input
  }

  function handleManualSubmit() {
    if (!manualCardId.trim() || !manualInput.trim()) return;

    const words = manualInput.split('\n')
      .map(line => line.trim())
      .filter(word => word);

    if (words.length === 0) return;

    const language = detectLanguage(words.length);
    const card = { id: manualCardId.trim(), words, language };
    setBingoCards([...bingoCards, card]);
    setManualInput('');
    setManualCardId('');
    setShowLoadModal(false);
  }

  function BingoCardGrid({ card }) {
    if (!card) return null;

    const config = LANGUAGE_CONFIGS[card.language];
    const gridStyle = {
      display: 'grid',
      gridTemplateColumns: `repeat(${config.cols}, 1fr)`,
      gridTemplateRows: `repeat(${config.rows}, 1fr)`,
      gap: '8px',
      padding: '20px',
    };

    return (
      <div className="bingo-card-container">
        <div className="bingo-card-header">
          <h3>Card ID: {card.id}</h3>
          <span className="language-badge">{card.language}</span>
        </div>
        <div className="bingo-card-grid" style={gridStyle}>
          {card.words.map((word, index) => (
            <div key={index} className="bingo-cell">
              {word}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {showStartModal && (
        <main className="modal-container">
          <div className="modal">
            <h1>Bingo</h1>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                registerUser(new FormData(e.currentTarget));
              }}
            >
              <input name="name" placeholder="Enter your name" />
              <button type="submit">Submit</button>
            </form>
          </div>
        </main>
      )}

      {showLoadModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Load Bingo Cards</h2>
            <div className="load-options">
              <div className="load-section">
                <h3>Upload from File</h3>
                <input
                  type="file"
                  accept=".txt"
                  onChange={handleFileUpload}
                  className="file-input"
                />
                <p className="help-text">Format: Each line = CARDID WORD1 WORD2 WORD3...</p>
              </div>

              <div className="divider">OR</div>

              <div className="load-section">
                <h3>Manual Input</h3>
                <input
                  type="text"
                  placeholder="Card ID"
                  value={manualCardId}
                  onChange={(e) => setManualCardId(e.target.value)}
                  className="manual-id-input"
                />
                <textarea
                  placeholder="Enter words, one per line"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="manual-input"
                  rows={10}
                />
                <button onClick={handleManualSubmit} className="submit-btn">
                  Add Card
                </button>
              </div>
            </div>
            {bingoCards.length > 0 && (
              <button onClick={() => setShowLoadModal(false)} className="close-btn">
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {!showStartModal && (
        <div className="bingo-app">
          <div className="top-bar">
            <div className="current-word-container">
              <h2>Current Word</h2>
              <div className="current-word">{currentWord || 'Waiting...'}</div>
            </div>
            <button onClick={() => setShowLoadModal(true)} className="add-card-btn">
              + Add Card
            </button>
          </div>

          <div className="main-content">
            <div className="cards-sidebar">
              <h3>Bingo Cards ({bingoCards.length})</h3>
              <div className="cards-list">
                {bingoCards.length === 0 ? (
                  <p className="empty-state">No cards loaded. Click "Add Card" to get started.</p>
                ) : (
                  bingoCards.map((card, index) => (
                    <div
                      key={card.id}
                      className={`card-item ${selectedCardIndex === index ? 'active' : ''}`}
                      onClick={() => setSelectedCardIndex(index)}
                    >
                      <div className="card-item-id">{card.id}</div>
                      <div className="card-item-info">
                        <span className="card-item-lang">{card.language}</span>
                        <span className="card-item-count">{card.words.length} words</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="main-card-area">
              {bingoCards.length > 0 ? (
                <BingoCardGrid card={bingoCards[selectedCardIndex]} />
              ) : (
                <div className="empty-card-area">
                  <p>Load a bingo card to get started</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
