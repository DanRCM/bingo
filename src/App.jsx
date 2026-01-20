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
  const [selectedCardIndex, setSelectedCardIndex] = useState(0);
  const [currentWord, setCurrentWord] = useState('');
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [manualCardId, setManualCardId] = useState('');
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [userName, setUserName] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState('');
  const [playerCount, setPlayerCount] = useState(0);
  const [gameStarted, setGameStarted] = useState(false);
  const [showWinnersModal, setShowWinnersModal] = useState(false);
  const [winners, setWinners] = useState(null);

  useEffect(() => {
    if (!showStartModal && bingoCards.length === 0) {
      setShowLoadModal(true);
    }
  }, [showStartModal, bingoCards.length]);

  // Setup websocket when name is submitted
  function setupWebSocket(name) {
    if (socketRef.current) return;

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setSocketReady(true);
      // Send user name
      socket.send(JSON.stringify({ type: 'register', user: name }));
    };

    socket.onclose = () => {
      setSocketReady(false);
      // Reload page on disconnect
      window.location.reload();
    };

    socket.onerror = () => {
      setSocketReady(false);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (e) {
        console.error('Error parsing websocket message:', e);
      }
    };
  }

  function handleWebSocketMessage(data) {
    switch (data.type) {
      case 'player_count':
        setPlayerCount(data.count);
        break;
      case 'game_started':
        setGameStarted(true);
        break;
      case 'round_start':
        setCurrentLanguage(data.language);
        break;
      case 'word_selected':
        setCurrentWord(data.word);
        // Mark word on cards (data.card_ids contains list of card IDs that should be marked)
        setBingoCards(prevCards => {
          const updated = prevCards.map(card => {
            // Check if this card should be marked (word is in card's words and card_id is in the list)
            if (data.card_ids && data.card_ids.includes(card.id) && card.words.includes(data.word)) {
              const markedWords = card.markedWords || [];
              if (!markedWords.includes(data.word)) {
                return { ...card, markedWords: [...markedWords, data.word] };
              }
            }
            return card;
          });
          
          // Auto-select card with most marked words after marking
          // Prefer cards matching the current language
          setTimeout(() => {
            let maxMarked = 0;
            let bestIndex = 0;
            let maxMarkedForLanguage = 0;
            let bestIndexForLanguage = 0;
            
            updated.forEach((card, index) => {
              const markedCount = card.markedWords ? card.markedWords.length : 0;
              if (markedCount > maxMarked) {
                maxMarked = markedCount;
                bestIndex = index;
              }
              // Prefer cards matching current language
              if (card.language === data.language && markedCount > maxMarkedForLanguage) {
                maxMarkedForLanguage = markedCount;
                bestIndexForLanguage = index;
              }
            });
            
            // Use language-specific card if available, otherwise use any card with most marks
            setSelectedCardIndex(maxMarkedForLanguage > 0 ? bestIndexForLanguage : bestIndex);
          }, 0);
          
          return updated;
        });
        break;
      case 'round_end':
        setCurrentWord('');
        setCurrentLanguage('');
        break;
      case 'game_end':
        setWinners(data.winners);
        setShowWinnersModal(true);
        break;
      default:
        break;
    }
  }

  // Send bingo card to server
  function sendBingoCard(card) {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'bingo_card',
        card: {
          id: card.id,
          words: card.words,
          language: card.language
        }
      }));
    }
  }

  // Calculate transmitted count from cards
  const transmittedCount = bingoCards.filter(card => card.transmitted === true).length;

  // Effect to handle card transmission - only trigger when new cards are added
  useEffect(() => {
    if (bingoCards.length === 0) {
      return;
    }

    // Check if there are untransmitted cards
    const hasUntransmitted = bingoCards.some(card => !card.transmitted);

    // Start transmitting if there are untransmitted cards and we're not already transmitting
    if (hasUntransmitted && !isTransmitting) {
      setIsTransmitting(true);
      transmitNextCard();
    }
  }, [bingoCards.length]);

  function transmitNextCard() {
    // Get current cards from state to avoid stale closures
    setBingoCards(prevCards => {
      // Find the first card that hasn't been transmitted
      const untransmittedIndex = prevCards.findIndex(card => !card.transmitted);

      if (untransmittedIndex === -1) {
        setIsTransmitting(false);
        return prevCards;
      }

      const card = prevCards[untransmittedIndex];
      sendBingoCard(card);

      // Mark card as transmitted
      const updatedCards = prevCards.map((c, idx) => 
        idx === untransmittedIndex ? { ...c, transmitted: true } : c
      );

      // Continue with next card after a small delay
      setTimeout(() => {
        const hasMoreUntransmitted = updatedCards.some(card => !card.transmitted);
        if (hasMoreUntransmitted) {
          transmitNextCard();
        } else {
          setIsTransmitting(false);
        }
      }, 100);

      return updatedCards;
    });
  }

  function registerUser(formData) {
    const name = formData.get("name");
    if (!name) return;

    setUserName(name);
    setupWebSocket(name);
    setShowStartModal(false);
  }

  function handleDisconnect() {
    if (socketRef.current) {
      socketRef.current.close();
    }
    window.location.reload();
  }

  function handlePlay() {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'play' }));
    }
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
      cards.push({ id, words, language, transmitted: false, markedWords: [] });
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
        // Add new cards (they have transmitted: false by default)
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
    const card = { id: manualCardId.trim(), words, language, transmitted: false, markedWords: [] };
    // Add new card (it has transmitted: false by default)
    setBingoCards([...bingoCards, card]);
    setManualInput('');
    setManualCardId('');
    setShowLoadModal(false);
  }

  function BingoCardGrid({ card }) {
    if (!card) return null;

    const config = LANGUAGE_CONFIGS[card.language];
    const markedWords = card.markedWords || [];
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
          <span className="marked-count">{markedWords.length}/{card.words.length} marked</span>
        </div>
        <div className="bingo-card-grid" style={gridStyle}>
          {card.words.map((word, index) => {
            const isMarked = markedWords.includes(word);
            return (
              <div key={index} className={`bingo-cell ${isMarked ? 'marked' : ''}`}>
                {word}
              </div>
            );
          })}
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
            <div className="modal-header">
              <h2>Load Bingo Cards</h2>
              <button 
                onClick={() => setShowLoadModal(false)} 
                className="modal-close-btn"
                aria-label="Close"
              >
                ×
              </button>
            </div>
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
            <div className="top-bar-info">
              {currentLanguage && (
                <div className="language-display">
                  Round: <span className="language-name">{currentLanguage.toUpperCase()}</span>
                </div>
              )}
              <div className="player-count">
                Players: {playerCount}
              </div>
            </div>
            <div className="top-bar-right">
              {bingoCards.length > 0 && !gameStarted && (
                <div className="transmission-status">
                  {transmittedCount < bingoCards.length ? (
                    <div className="loading-status">
                      {transmittedCount}/{bingoCards.length} bingo cards loaded
                    </div>
                  ) : (
                    <button onClick={handlePlay} className="play-btn">
                      PLAY
                    </button>
                  )}
                </div>
              )}
              {!gameStarted && (
                <button onClick={() => setShowLoadModal(true)} className="add-card-btn">
                  + Add Card
                </button>
              )}
              <button onClick={handleDisconnect} className="disconnect-btn">
                Disconnect
              </button>
            </div>
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

      {showWinnersModal && winners && (
        <div className="modal-overlay">
          <div className="modal winners-modal">
            <div className="modal-header">
              <h2>Game Over!</h2>
            </div>
            <div className="winners-content">
              {winners.length === 1 ? (
                <div className="single-winner">
                  <h3>Winner!</h3>
                  <p>{winners[0]}</p>
                </div>
              ) : (
                <div className="draw">
                  <h3>Draw!</h3>
                  <p>{winners.length} winners:</p>
                  <ul>
                    {winners.map((winner, idx) => (
                      <li key={idx}>{winner}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button onClick={handleDisconnect} className="disconnect-btn">
                Disconnect & Reload
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App
