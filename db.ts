// FIX: The main Dexie class is a default export, so it must be imported as `import Dexie from 'dexie'`.
// The previous named import (`import { Dexie }`) was incorrect and caused all subsequent TypeScript errors
// because the compiler did not recognize the class and its methods (`.version()`, `.transaction()`, etc.).
// FIX: The combined import of a default export and a named type export might cause issues with some tooling. Splitting it into two separate imports resolves the type resolution errors for the Dexie class.
import Dexie from 'dexie';
import type { Table } from 'dexie';

// --- TYPES (Moved from index.tsx to break circular dependency) ---
export interface ApiKey {
    id: string;
    name: string;
    key: string;
}

export interface ApiConfig {
    model: 'gemini-2.5-flash' | 'gemini-2.5-pro';
    temperature: number;
}

export interface Character {
    id: string;
    name: string;
    avatarUrl: string; // Can be a URL or a Base64 string
    chatBackgroundUrl?: string; // Character-specific background
    nicknameForUser?: string;
    systemInstruction: string;
    autoReplyDelay?: number; // Delay in minutes before sending an auto-reply. 0 or undefined means disabled.
}

export type ChatMessagePayload = 
    | { type: 'text'; content: string }
    | { type: 'image'; description: string } // Changed from imageUrl
    | { type: 'sticker'; stickerId: string }
    | { type: 'transfer'; amount: number; notes?: string }
    | { type: 'location'; name: string }; // Changed from latitude/longitude

export interface ChatMessage {
    id: string;
    characterId: string;
    role: 'user' | 'model';
    payload: ChatMessagePayload;
    timestamp: number;
    edited?: boolean;
}


export interface Comment {
    id: string;
    authorId: string; // 'user' or characterId
    content: string;
}

export interface MomentPost {
    id: string;
    authorId: string; // 'user' or characterId
    content: string;
    timestamp: string;
    comments: Comment[];
    likes: string[];
}

export interface CustomSticker {
    id: string;
    name: string;
    imageUrl: string; // Base64 string
}

export type Theme = 'wechat' | 'sakura-pink' | 'ocean-blue' | 'mint-green' | 'lavender-dream';


// Define a generic settings interface for key-value storage
export interface Setting {
    key: string;
    value: any;
}

export class ChaatDB extends Dexie {
    // Declare tables
    apiKeys!: Table<ApiKey, string>;
    characters!: Table<Character, string>;
    chats!: Table<ChatMessage, string>;
    posts!: Table<MomentPost, string>;
    customStickers!: Table<CustomSticker, string>;
    settings!: Table<Setting, string>; // Simple key-value store

    constructor() {
        super('chaatDB');
        // FIX: This was failing due to a circular dependency with index.tsx. Moving types here resolves the issue.
        this.version(1).stores({
            apiKeys: 'id',
            characters: 'id',
            // FIX: '++id' is for auto-incrementing numbers. ChatMessage.id is a string, so we just use 'id'.
            chats: 'id, characterId',
            posts: 'id',
            customStickers: 'id',
            settings: 'key',
        });
    }
}

export const db = new ChaatDB();