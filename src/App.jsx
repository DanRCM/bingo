import { useEffect, useRef, useState } from 'react';
import './App.css'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:8000";

function getWebSocketUrl(userId) {
  let wsUrl;
  if (SERVER_URL.startsWith('http://')) {
    wsUrl = SERVER_URL.replace('http://', 'ws://');
  } else if (SERVER_URL.startsWith('https://')) {
    wsUrl = SERVER_URL.replace('https://', 'wss://');
  } else {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    wsUrl = `${protocol}//${SERVER_URL || window.location.host}`;
  }
  return `${wsUrl}/ws/${userId}`;
}

const userUUID = crypto.randomUUID();

const LANGUAGE_CONFIGS = {
  spanish: { rows: 4, cols: 6, total: 24 },
  english: { rows: 2, cols: 7, total: 14 },
  portuguese: { rows: 5, cols: 4, total: 20 },
  dutch: { rows: 2, cols: 5, total: 10 },
};

function detectLanguage(wordCount) {
  for (const [lang, config] of Object.entries(LANGUAGE_CONFIGS)) {
    if (config.total === wordCount) return lang;
  }
  return 'spanish';
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

  const [showRoundModal, setShowRoundModal] = useState(false);
  const [roundResults, setRoundResults] = useState({ winners: [], language: '' });

  useEffect(() => {
    if (!showStartModal && bingoCards.length === 0) {
      setShowLoadModal(true);
    }
  }, [showStartModal, bingoCards.length]);

  function setupWebSocket(name) {
    if (socketRef.current) return;

    const wsUrl = getWebSocketUrl(userUUID);
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      setSocketReady(true);
      socket.send(JSON.stringify({ type: 'register', user: name }));
    };

    socket.onclose = () => {
      setSocketReady(false);
      setTimeout(() => window.location.reload(), 2000);
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
        setBingoCards(prevCards => {
          const updated = prevCards.map(card => {
            if (data.card_ids && data.card_ids.includes(card.id) && card.words.includes(data.word)) {
              const markedWords = card.markedWords || [];
              if (!markedWords.includes(data.word)) {
                return { ...card, markedWords: [...markedWords, data.word] };
              }
            }
            return card;
          });
          
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
              if (card.language === data.language && markedCount > maxMarkedForLanguage) {
                maxMarkedForLanguage = markedCount;
                bestIndexForLanguage = index;
              }
            });
            
            setSelectedCardIndex(maxMarkedForLanguage > 0 ? bestIndexForLanguage : bestIndex);
          }, 0);
          
          return updated;
        });
        break;
      
      case 'round_end':
        setCurrentWord('');
        setRoundResults({
            winners: data.winners || [],
            language: data.language
        });
        setShowRoundModal(true);
        break;

      case 'game_end':
        setWinners(data.winners);
        setShowWinnersModal(true);
        setShowRoundModal(false); 
        break;
      default:
        break;
    }
  }

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

  const transmittedCount = bingoCards.filter(card => card.transmitted === true).length;

  useEffect(() => {
    if (bingoCards.length === 0) return;
    const hasUntransmitted = bingoCards.some(card => !card.transmitted);
    if (hasUntransmitted && !isTransmitting) {
      setIsTransmitting(true);
      transmitNextCard();
    }
  }, [bingoCards.length]);

  function transmitNextCard() {
    setBingoCards(prevCards => {
      const untransmittedIndex = prevCards.findIndex(card => !card.transmitted);
      if (untransmittedIndex === -1) {
        setIsTransmitting(false);
        return prevCards;
      }
      const card = prevCards[untransmittedIndex];
      sendBingoCard(card);
      const updatedCards = prevCards.map((c, idx) => 
        idx === untransmittedIndex ? { ...c, transmitted: true } : c
      );
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
    if (socketRef.current) socketRef.current.close();
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
      if (parts.length < 2) continue;
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
        setBingoCards([...bingoCards, ...newCards]);
        setShowLoadModal(false);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function handleManualSubmit() {
    if (!manualCardId.trim() || !manualInput.trim()) return;
    const words = manualInput.split('\n').map(line => line.trim()).filter(word => word);
    if (words.length === 0) return;
    const language = detectLanguage(words.length);
    const card = { id: manualCardId.trim(), words, language, transmitted: false, markedWords: [] };
    setBingoCards([...bingoCards, card]);
    setManualInput('');
    setManualCardId('');
    setShowLoadModal(false);
  }

  function BingoCardGrid({ card, isThumbnail = false }) {
    if (!card) return null;

    const config = LANGUAGE_CONFIGS[card.language];
    const markedWords = card.markedWords || [];
    
    const gridStyle = {
      display: 'grid',
      gridTemplateColumns: `repeat(${config.cols}, 1fr)`,
      gridTemplateRows: `repeat(${config.rows}, 1fr)`,
      gap: isThumbnail ? '4px' : '8px', 
      padding: isThumbnail ? '10px' : '20px', 
    };

    const baseCellStyle = {
        fontSize: isThumbnail ? '0.75rem' : '1rem',
        padding: isThumbnail ? '2px' : '10px',
        minHeight: isThumbnail ? '30px' : 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        wordBreak: 'break-word',
        borderRadius: '4px',
        border: '1px solid #444',
        transition: 'all 0.2s ease'
    };

    return (
      <div className="bingo-card-container" style={{ width: '100%', background: '#1a1a1a', borderRadius: '12px' }}>
        <div className="bingo-card-header" style={{ marginBottom: isThumbnail ? '5px' : '15px' }}>
          <h3 style={{ fontSize: isThumbnail ? '1.1rem' : '1.5rem', margin: '5px 0' }}>
            {isThumbnail ? `${card.id}` : `Card ID: ${card.id}`}
          </h3>
          <span className="language-badge" style={{ fontSize: isThumbnail ? '0.7rem' : '0.9rem', padding: '2px 8px' }}>
            {card.language}
          </span>
          <span className="marked-count" style={{ fontSize: isThumbnail ? '0.7rem' : '0.9rem' }}>
            {markedWords.length}/{card.words.length} {isThumbnail ? '' : 'marked'}
          </span>
        </div>
        <div className="bingo-card-grid" style={gridStyle}>
          {card.words.map((word, index) => {
            const isMarked = markedWords.includes(word);
            
            const finalStyle = {
                ...baseCellStyle,
                backgroundColor: isMarked ? '#22c55e' : '#2a2a2a', 
                color: isMarked ? 'white' : '#ffffff',
                fontWeight: isMarked ? 'bold' : 'normal',
                borderColor: isMarked ? '#22c55e' : '#444'
            };

            return (
              <div key={index} style={finalStyle}>
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
            <form onSubmit={(e) => {
                e.preventDefault();
                registerUser(new FormData(e.currentTarget));
            }}>
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
              <button onClick={() => setShowLoadModal(false)} className="modal-close-btn">×</button>
            </div>
            <div className="load-options">
              <div className="load-section">
                <h3>Upload from File</h3>
                <input type="file" accept=".txt" onChange={handleFileUpload} className="file-input" />
                <p className="help-text">Format: Each line = CARDID WORD1 WORD2 WORD3...</p>
              </div>
              <div className="divider">OR</div>
              <div className="load-section">
                <h3>Manual Input</h3>
                <input type="text" placeholder="Card ID" value={manualCardId} onChange={(e) => setManualCardId(e.target.value)} className="manual-id-input" />
                <textarea placeholder="Enter words, one per line" value={manualInput} onChange={(e) => setManualInput(e.target.value)} className="manual-input" rows={10} />
                <button onClick={handleManualSubmit} className="submit-btn">Add Card</button>
              </div>
            </div>
            {bingoCards.length > 0 && (
              <button onClick={() => setShowLoadModal(false)} className="close-btn">Close</button>
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
              <div className="player-count">Players: {playerCount}</div>
            </div>
            <div className="top-bar-right">
              {bingoCards.length > 0 && !gameStarted && (
                <div className="transmission-status">
                  {transmittedCount < bingoCards.length ? (
                    <div className="loading-status">{transmittedCount}/{bingoCards.length} bingo cards loaded</div>
                  ) : (
                    <button onClick={handlePlay} className="play-btn">PLAY</button>
                  )}
                </div>
              )}
              {!gameStarted && <button onClick={() => setShowLoadModal(true)} className="add-card-btn">+ Add Card</button>}
              <button onClick={handleDisconnect} className="disconnect-btn">Disconnect</button>
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
                    <div key={card.id} className={`card-item ${selectedCardIndex === index ? 'active' : ''}`} onClick={() => setSelectedCardIndex(index)}>
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
                <div className="empty-card-area"><p>Load a bingo card to get started</p></div>
              )}
            </div>
          </div>
        </div>
      )}

      {showRoundModal && (
        <div className="modal-overlay">
          <div className="modal winners-modal" style={{ maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h2>Fin de la ronda: {roundResults.language.toUpperCase()}</h2>
            </div>
            
            <div className="winners-content">
              {roundResults.winners.length === 0 ? (
                <div className="no-winners"><h3>No hubo ganadores en esta ronda.</h3></div>
              ) : (
                <div className="winners-list-detailed">
                  <h3>¡BINGO! Ganadores:</h3>
                  <div className="winners-cards-container" style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '20px',
                    padding: '10px',
                    justifyContent: 'center'
                  }}>
                    {roundResults.winners.map((winnerData, idx) => (
                      <div key={idx} className="winner-card-entry" style={{
                        border: '2px solid #FFD700', 
                        borderRadius: '10px',
                        padding: '10px',
                        background: '#fff9e6',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                      }}>
                        <h4 style={{color: '#d35400', margin: '0 0 10px 0'}}>
                          🏆 {winnerData.name || 'Unknown'}
                        </h4>
                        <BingoCardGrid card={winnerData.card} isThumbnail={true} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              <p style={{marginTop: '20px', fontStyle: 'italic'}}>Preparando siguiente idioma...</p>
              <button onClick={() => setShowRoundModal(false)} className="close-btn">Continuar</button>
            </div>
          </div>
        </div>
      )}

      {showWinnersModal && winners && (
        <div className="modal-overlay">
          <div className="modal winners-modal">
            <div className="modal-header"><h2>¡Juego Terminado!</h2></div>
            <div className="winners-content">
              {winners.length === 0 ? (
                 <div className="no-winners"><h3>Nadie ganó el bingo final.</h3></div>
              ) : winners.length === 1 ? (
                <div className="single-winner">
                  <h3>¡Gran Ganador!</h3>
                  <p className="winner-name">{winners[0]}</p>
                </div>
              ) : (
                <div className="draw">
                  <h3>¡Empate!</h3>
                  <p>{winners.length} ganadores:</p>
                  <ul className="winners-list-final">
                    {winners.map((winner, idx) => (<li key={idx}>{winner}</li>))}
                  </ul>
                </div>
              )}
              <button onClick={handleDisconnect} className="disconnect-btn">Desconectar y Reiniciar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App