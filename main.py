from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import json
import random
import asyncio
from typing import Dict, List, Set, Optional
from collections import defaultdict
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Configuración de CORS para permitir conexión desde Vercel
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class BingoCard:
    def __init__(self, card_id: str, words: List[str], language: str):
        self.id = card_id
        self.words = words
        self.language = language
        self.marked_words: Set[str] = set()

    def mark_word(self, word: str):
        if word in self.words:
            self.marked_words.add(word)

    def is_complete(self) -> bool:
        return len(self.marked_words) == len(self.words)

    def get_marked_count(self) -> int:
        return len(self.marked_words)


class User:
    def __init__(self, user_id: str, name: str, websocket: WebSocket):
        self.id = user_id
        self.name = name
        self.websocket = websocket
        self.cards: Dict[str, BingoCard] = {}
        self.word_to_cards: Dict[str, List[str]] = defaultdict(list)

    def add_card(self, card: BingoCard):
        self.cards[card.id] = card
        for word in card.words:
            self.word_to_cards[word].append(card.id)

    def mark_word(self, word: str, language: str) -> List[str]:
        marked_card_ids = []
        if word in self.word_to_cards:
            for card_id in self.word_to_cards[word]:
                card = self.cards.get(card_id)
                if card and card.language == language:
                    card.mark_word(word)
                    marked_card_ids.append(card_id)
        return marked_card_ids

    def get_completed_cards(self, language: str) -> List[BingoCard]:
        completed = []
        for card in self.cards.values():
            if card.language == language and card.is_complete():
                completed.append(card)
        return completed    

    def remove_words_from_sets(self, language_to_words: Dict[str, Set[str]]):
        for card in self.cards.values():
            for word in card.words:
                if word in language_to_words.get(card.language, set()):
                    language_to_words[card.language].discard(word)


class GameManager:
    def __init__(self):
        self.users: Dict[str, User] = {}
        self.language_word_sets: Dict[str, Set[str]] = {
            "spanish": set(),
            "english": set(),
            "portuguese": set(),
            "dutch": set(),
        }
        self.game_started = False
        self.current_round = None
        self.round_languages = []
        self.current_language_index = 0
        self.winners: List[str] = []

    async def add_user(self, user_id: str, name: str, websocket: WebSocket):
        user = User(user_id, name, websocket)
        self.users[user_id] = user
        await self.broadcast_player_count()

    async def remove_user(self, user_id: str):
        if user_id in self.users:
            # Nota: No borramos las palabras del set global para no afectar a otros jugadores
            del self.users[user_id]
            await self.broadcast_player_count()

            if len(self.users) == 0:
                self.reset_game()

    async def add_card(self, user_id: str, card_data: dict):
        if user_id not in self.users:
            return

        user = self.users[user_id]
        card = BingoCard(card_data["id"], card_data["words"], card_data["language"])
        user.add_card(card)

        language = card.language
        for word in card.words:
            self.language_word_sets[language].add(word)

    async def start_game(self):
        if self.game_started:
            return

        languages = ["spanish", "english", "portuguese", "dutch"]
        self.round_languages = random.sample(languages, len(languages))
        self.current_language_index = 0
        self.game_started = True

        await self.broadcast({"type": "game_started"})
        await self.start_round()

    async def start_round(self):
        if self.current_language_index >= len(self.round_languages):
            await self.end_game()
            return

        language = self.round_languages[self.current_language_index]
        self.current_round = language

        await self.broadcast(
            {
                "type": "round_start",
                "language": language,
                "round_number": self.current_language_index + 1,
                "total_rounds": len(self.round_languages),
            }
        )

        await self.round_loop()

    async def round_loop(self):
        language = self.current_round
        word_set = self.language_word_sets.get(language, set())
        available_words = list(word_set)

        while available_words:
            word = random.choice(available_words)
            available_words.remove(word)

            # --- CORRECCIÓN CRÍTICA: Usamos list() para evitar errores de concurrencia ---
            for user_id, user in list(self.users.items()):
                marked_card_ids = user.mark_word(word, language)
                await self.send_to_user(
                    user_id,
                    {
                        "type": "word_selected",
                        "word": word,
                        "language": language,
                        "card_ids": marked_card_ids,
                    },
                )

            winners_details = [] 

            # --- CORRECCIÓN CRÍTICA: Usamos list() aquí también ---
            for user_id, user in list(self.users.items()):
                completed_cards = user.get_completed_cards(language)
                
                for card in completed_cards:
                    winners_details.append({
                        "name": user.name,
                        "card": {
                            "id": card.id,
                            "words": card.words,
                            "language": card.language,
                            "markedWords": list(card.marked_words)
                        }
                    })

            if winners_details:
                self.winners.extend([w["name"] for w in winners_details])
                
                await self.broadcast(
                    {
                        "type": "round_end",
                        "language": language,
                        "winners": winners_details,
                    }
                )
                
                await asyncio.sleep(8) 
                self.current_language_index += 1
                await self.start_round()
                return

            await asyncio.sleep(2)

        await self.broadcast({"type": "round_end", "language": language, "winners": []})
        await asyncio.sleep(5)
        self.current_language_index += 1
        await self.start_round()

    async def end_game(self):
        winner_counts = defaultdict(int)
        for winner in self.winners:
            winner_counts[winner] += 1

        unique_winners = list(winner_counts.keys())
        await self.broadcast({"type": "game_end", "winners": unique_winners})
        self.reset_game()

    def reset_game(self):
        self.game_started = False
        self.current_round = None
        self.round_languages = []
        self.current_language_index = 0
        self.winners = []
        for user in self.users.values():
            for card in user.cards.values():
                card.marked_words.clear()

    async def broadcast(self, message: dict):
        message_str = json.dumps(message)
        disconnected = []
        # Usamos list() para evitar errores si alguien se desconecta durante el envío
        for user_id, user in list(self.users.items()):
            try:
                await user.websocket.send_text(message_str)
            except:
                disconnected.append(user_id)

        for user_id in disconnected:
            await self.remove_user(user_id)

    async def broadcast_player_count(self):
        await self.broadcast({"type": "player_count", "count": len(self.users)})

    async def send_to_user(self, user_id: str, message: dict):
        if user_id in self.users:
            try:
                message_str = json.dumps(message)
                await self.users[user_id].websocket.send_text(message_str)
            except:
                await self.remove_user(user_id)


game_manager = GameManager()


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "register":
                user_name = data.get("user", "Unknown")
                await game_manager.add_user(client_id, user_name, websocket)
            
            elif msg_type == "bingo_card":
                if client_id in game_manager.users:
                    await game_manager.add_card(client_id, data.get("card", {}))
            
            elif msg_type == "play":
                if not game_manager.game_started:
                    await game_manager.start_game()

    except WebSocketDisconnect:
        await game_manager.remove_user(client_id)
    except Exception:
        await game_manager.remove_user(client_id)