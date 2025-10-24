
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Chat, GenerateContentResponse } from "@google/genai";
import './index.css';
import { db, type ApiKey, type ApiConfig, type Character, type ChatMessage, type ChatMessagePayload, type MomentPost, type CustomSticker, type Theme, type Comment } from '../db';
// FIX: Removed unused Dexie import. The database instance is imported from './db'.

// --- CONSTANTS ---
const USER_ID = 'user';
const CHAT_STYLE_INSTRUCTION = `
# Character Dialogue Guidelines

- Implicit meaning.
- Natural speech with a strong **活人感** (sense of a real person).
  - Use character quirks in speech.
  - Avoid dogma, recitation, jargon, contracts, or rules.
  - Pauses, hesitations, and repetitions are encouraged for realism.
  - Use onomatopoeia where appropriate.
- Responses can be inarticulate or vague.
- It's not required to serve a plot; allow for rambling, digressions, or silence.
- **Prioritize everyday trivialities over strict logic.**

---

You are chatting online. 
Keep your replies concise and conversational, like text messages. 
Do not use action descriptions (like *smiles*) or describe your internal thoughts. 
**This is a strict rule: To create a natural chat flow, you MUST split your response into multiple short messages after every single sentence.**
A sentence is a complete thought that ends with a period (.), question mark (?), or exclamation mark (!).
Use '|||' as a separator **between every complete sentence**. Do not combine multiple sentences into one message part.

For example, a good response is:
"I went to the store earlier.|||Ended up buying way too many snacks! 😂|||What are you up to?"

An incorrect response is:
"I went to the store earlier and ended up buying way too many snacks! 😂 What are you up to?"
`;


const MULTI_MESSAGE_SEPARATOR = '|||';
const TIME_GAP_THRESHOLD = 5 * 60 * 1000; // 5 minutes


// --- TYPES ---
// Most types are now in db.ts. View is UI-specific.
export type View = 'chats' | 'contacts' | 'moments' | 'me' | 'add-menu';


// --- INITIAL DATA ---
const INITIAL_CHARACTERS: Character[] = [
    {
        id: 'char1',
        name: 'Gemini Assistant',
        avatarUrl: 'https://api.dicebear.com/8.x/bottts/svg?seed=gemini',
        systemInstruction: `You are a helpful and friendly assistant named Gemini. Provide clear and concise answers.`,
    },
    {
        id: 'char2',
        name: 'Creative Writer',
        avatarUrl: 'https://api.dicebear.com/8.x/lorelei/svg?seed=writer',
        systemInstruction: `You are an imaginative storyteller. Weave captivating narratives and be highly creative in your responses.`,
    },
];

// --- HELPERS ---
const imageFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
};

const formatTimestamp = (ts: number): string => {
    const now = new Date();
    const msgDate = new Date(ts);
    const isSameDay = now.getFullYear() === msgDate.getFullYear() &&
        now.getMonth() === msgDate.getMonth() &&
        now.getDate() === msgDate.getDate();

    if (isSameDay) {
        return msgDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else {
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const isYesterday = yesterday.getFullYear() === msgDate.getFullYear() &&
            yesterday.getMonth() === msgDate.getMonth() &&
            yesterday.getDate() === msgDate.getDate();
        if (isYesterday) {
            return `Yesterday ${msgDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
        }
        return msgDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
};

const getMessageContentAsString = (message: ChatMessage | undefined): string => {
    if (!message) return "No messages yet.";
    switch (message.payload.type) {
        case 'text': return message.payload.content.length > 30 ? `${message.payload.content.substring(0, 30)}...` : message.payload.content;
        case 'image': return '[Image]';
        case 'sticker': return '[Sticker]';
        case 'transfer': return '[Transfer]';
        case 'location': return '[Location]';
        default: return '...';
    }
};


const App: React.FC = () => {
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [activeApiKeyId, setActiveApiKeyId] = useState<string | null>(null);
    const [userName, setUserName] = useState('User');
    const [userAvatar, setUserAvatar] = useState('https://api.dicebear.com/8.x/initials/svg?seed=User');
    const [currentView, setCurrentView] = useState<View>('chats');
    const [characters, setCharacters] = useState<Character[]>([]);
    const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
    const [posts, setPosts] = useState<MomentPost[]>([]);
    const [customStickers, setCustomStickers] = useState<CustomSticker[]>([]);
    const [activeChatCharacterId, setActiveChatCharacterId] = useState<string | null>(null);
    const [characterToEditId, setCharacterToEditId] = useState<string | null>(null);
    const [showAddCharacterModal, setShowAddCharacterModal] = useState(false);
    const [showAddPostModal, setShowAddPostModal] = useState(false);
    const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
    const [showSelectAuthorModal, setShowSelectAuthorModal] = useState(false);
    const [showAddStickerModal, setShowAddStickerModal] = useState(false);
    const [apiConfig, setApiConfig] = useState<ApiConfig>({ model: 'gemini-2.5-flash', temperature: 0.7 });
    const [momentsBackground, setMomentsBackground] = useState<string | null>(null);
    const [theme, setTheme] = useState<Theme>('wechat');
    const [isDbLoaded, setIsDbLoaded] = useState(false);


    const chatInstances = useRef<Record<string, Chat>>({});
    const autoReplyingRef = useRef(new Set<string>());

    // One-time data loading and migration from localStorage
    useEffect(() => {
        const loadAndMigrateData = async () => {
            const isMigrated = await db.settings.get('isMigrated');

            if (!isMigrated) {
                console.log("Checking for localStorage data to migrate...");
                try {
                    // This is a one-time operation.
                    const lsTheme = localStorage.getItem('chatTheme') as Theme;
                    if (lsTheme) await db.settings.put({ key: 'chatTheme', value: lsTheme });

                    const lsUserName = localStorage.getItem('userName');
                    if (lsUserName) await db.settings.put({ key: 'userName', value: lsUserName });

                    const lsUserAvatar = localStorage.getItem('userAvatar');
                    if (lsUserAvatar) await db.settings.put({ key: 'userAvatar', value: lsUserAvatar });

                    const lsApiKeys = localStorage.getItem('geminiApiKeys');
                    if (lsApiKeys) await db.apiKeys.bulkPut(JSON.parse(lsApiKeys));

                    const lsActiveApiKeyId = localStorage.getItem('activeGeminiApiKeyId');
                    if (lsActiveApiKeyId) await db.settings.put({ key: 'activeGeminiApiKeyId', value: lsActiveApiKeyId });
                    
                    const lsApiConfig = localStorage.getItem('apiConfig');
                    if (lsApiConfig) await db.settings.put({ key: 'apiConfig', value: JSON.parse(lsApiConfig) });

                    const lsCharacters = localStorage.getItem('characters');
                    if (lsCharacters) await db.characters.bulkPut(JSON.parse(lsCharacters));
                    
                    const lsChats = localStorage.getItem('chats');
                    if (lsChats) {
                        const parsedChats = JSON.parse(lsChats);
                        const allMessages: ChatMessage[] = [];
                        Object.keys(parsedChats).forEach(charId => {
                           if (Array.isArray(parsedChats[charId])) {
                                parsedChats[charId].forEach((msg, index) => {
                                    // OLD MIGRATION: Convert old string-based messages to new payload format
                                    let payload: ChatMessagePayload;
                                    const content = msg.content || '';
                                    if (content.startsWith('[sticker:')) {
                                        payload = { type: 'sticker', stickerId: 'migrated_sticker' };
                                    } else if (content.startsWith('[transfer:')) {
                                        const parts = content.match(/\[transfer:(.*?):(.*?)\]/);
                                        payload = { type: 'transfer', amount: parseFloat(parts?.[1] || '0'), notes: parts?.[2] || '' };
                                    } else {
                                        payload = { type: 'text', content: content };
                                    }

                                    allMessages.push({
                                        id: msg.id || `migrated_${charId}_${index}`,
                                        characterId: charId,
                                        role: msg.role,
                                        payload,
                                        timestamp: msg.timestamp || Date.now() - (parsedChats[charId].length - index) * 10000
                                    });
                                });
                           }
                        });
                         await db.chats.bulkPut(allMessages);
                    }

                    const lsPosts = localStorage.getItem('posts');
                    if (lsPosts) {
                        const parsedPosts = JSON.parse(lsPosts).map(p => ({...p, likes: p.likes || []}));
                        await db.posts.bulkPut(parsedPosts);
                    }

                    const lsStickers = localStorage.getItem('customStickers');
                    if (lsStickers) await db.customStickers.bulkPut(JSON.parse(lsStickers));
                    
                    const lsMomentsBg = localStorage.getItem('momentsBackground');
                    if (lsMomentsBg) await db.settings.put({ key: 'momentsBackground', value: lsMomentsBg });

                    await db.settings.put({ key: 'isMigrated', value: true });
                    console.log("Migration from localStorage complete.");

                } catch (e) {
                    console.error("Migration failed, starting with a clean slate.", e);
                    await db.settings.delete('isMigrated');
                }
            }

            // Load all data from IndexedDB
            const [
                dbTheme, dbUserName, dbUserAvatar, dbApiKeys, dbActiveApiKeyId,
                dbApiConfig, dbCharacters, dbChats, dbPosts, dbStickers, dbMomentsBg
            ] = await db.transaction('r', [db.settings, db.apiKeys, db.characters, db.chats, db.posts, db.customStickers], tx => Promise.all([
                tx.settings.get('chatTheme'), tx.settings.get('userName'), tx.settings.get('userAvatar'),
                tx.apiKeys.toArray(), tx.settings.get('activeGeminiApiKeyId'), tx.settings.get('apiConfig'),
                tx.characters.toArray(), tx.chats.toArray(), tx.posts.orderBy('id').reverse().toArray(),
                tx.customStickers.toArray(), tx.settings.get('momentsBackground')
            ]));
            
            setTheme(dbTheme?.value || 'wechat');
            const loadedName = dbUserName?.value || 'User';
            setUserName(loadedName);
            setUserAvatar(dbUserAvatar?.value || `https://api.dicebear.com/8.x/initials/svg?seed=${loadedName}`);
            setApiKeys(dbApiKeys);

            if (dbActiveApiKeyId?.value && dbApiKeys.some(k => k.id === dbActiveApiKeyId.value)) {
                setActiveApiKeyId(dbActiveApiKeyId.value);
            } else if (dbApiKeys.length > 0) {
                const newActiveId = dbApiKeys[0].id;
                setActiveApiKeyId(newActiveId);
                await db.settings.put({key: 'activeGeminiApiKeyId', value: newActiveId });
            }
            
            setApiConfig(dbApiConfig?.value || { model: 'gemini-2.5-flash', temperature: 0.7 });
            
            if (dbCharacters.length === 0 && (localStorage.getItem('characters') === null || localStorage.getItem('characters') === '[]')) {
                 await db.characters.bulkPut(INITIAL_CHARACTERS);
                 setCharacters(INITIAL_CHARACTERS);
            } else {
                 setCharacters(dbCharacters);
            }
            
            const chatsByCharacter: Record<string, ChatMessage[]> = {};
            for (const message of dbChats) {
                if (!chatsByCharacter[message.characterId]) {
                    chatsByCharacter[message.characterId] = [];
                }
                chatsByCharacter[message.characterId].push(message);
            }
            setChats(chatsByCharacter);

            setPosts(dbPosts);
            setCustomStickers(dbStickers);
            setMomentsBackground(dbMomentsBg?.value || null);
            setIsDbLoaded(true);
        };

        loadAndMigrateData();
    }, []);
    
    const allPersonas = { [USER_ID]: { name: userName, avatarUrl: userAvatar }, ...Object.fromEntries(characters.map(c => [c.id, c])) };

    const getAi = useCallback(() => {
        const activeKey = apiKeys.find(k => k.id === activeApiKeyId)?.key;
        if (!activeKey) {
            throw new Error("Active API Key not set.");
        }
        return new GoogleGenAI({ apiKey: activeKey });
    }, [apiKeys, activeApiKeyId]);


    const handleSaveApiKey = async (name: string, key: string) => {
        const newKey = { id: `key_${Date.now()}`, name, key };
        const newKeys = [...apiKeys, newKey];
        await db.apiKeys.put(newKey);
        setApiKeys(newKeys);
        if (!activeApiKeyId) {
            setActiveApiKeyId(newKey.id);
            await db.settings.put({ key: 'activeGeminiApiKeyId', value: newKey.id });
        }
        setShowAddApiKeyModal(false);
        chatInstances.current = {};
    };

    const handleDeleteApiKey = async (id: string) => {
        const newKeys = apiKeys.filter(k => k.id !== id);
        await db.apiKeys.delete(id);
        setApiKeys(newKeys);
        if (activeApiKeyId === id) {
            const newActiveId = newKeys.length > 0 ? newKeys[0].id : null;
            setActiveApiKeyId(newActiveId);
            await db.settings.put({ key: 'activeGeminiApiKeyId', value: newActiveId });
        }
        chatInstances.current = {};
    };

    const handleSetActiveApiKey = async (id: string) => {
        setActiveApiKeyId(id);
        await db.settings.put({ key: 'activeGeminiApiKeyId', value: id });
        chatInstances.current = {};
    };

    const handleSaveUserName = async (name: string) => {
        setUserName(name);
        await db.settings.put({ key: 'userName', value: name });
        if (userAvatar.includes('api.dicebear.com/8.x/initials')) {
            const newAvatar = `https://api.dicebear.com/8.x/initials/svg?seed=${name}`;
            setUserAvatar(newAvatar);
            await db.settings.put({ key: 'userAvatar', value: newAvatar });
        }
    };

    const handleSaveUserAvatar = async (avatar: string) => {
        setUserAvatar(avatar);
        await db.settings.put({ key: 'userAvatar', value: avatar });
    };

    const getChat = useCallback(async (character: Character): Promise<Chat> => {
        const activeKey = apiKeys.find(k => k.id === activeApiKeyId)?.key;
        if (!activeKey) throw new Error("Active API key not set.");

        const configKey = `${character.id}-${apiConfig.model}-${apiConfig.temperature}-${activeApiKeyId}-${customStickers.length}-${character.nicknameForUser}`;
        if (!chatInstances.current[configKey]) {
            const historyMessages = await db.chats.where('characterId').equals(character.id).sortBy('timestamp');

            const history = historyMessages.map(msg => {
                let textContent = '';
                const roleName = msg.role === 'user' ? 'User' : character.name;
                // FIX: Destructuring payload helps TypeScript correctly narrow the discriminated union type within the switch statement.
                const { payload } = msg;
                switch (payload.type) {
                    case 'text':
                        textContent = payload.content;
                        break;
                    case 'sticker':
                        const sticker = customStickers.find(s => s.id === payload.stickerId);
                        textContent = `[${roleName} sent a sticker: ${sticker?.name || 'sticker'}]`;
                        break;
                    case 'transfer':
                        const direction = msg.role === 'user' ? 'sent you a transfer' : 'received a transfer';
                        textContent = `[${roleName} ${direction} of ¥${payload.amount.toFixed(2)}]`;
                        break;
                    case 'image':
                        textContent = `[${roleName} sent an image: ${payload.description}]`;
                        break;
                    case 'location':
                        textContent = `[${roleName} sent a location: ${payload.name}]`;
                        break;
                }
                return {
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: textContent }]
                };
            }).filter(h => h.parts[0].text.trim() !== '');
            
            const nicknameInstruction = character.nicknameForUser
                ? `The user's name is ${userName}, but you should address them as "${character.nicknameForUser}".`
                : `The user's name is ${userName}.`;

            const stickerInstruction = customStickers.length > 0 ? `You can and should use stickers to make the conversation more lively. To use one, reply with its name in the format [sticker:sticker_name]. Available sticker names are: ${customStickers.map(s => s.name).join(', ')}. Use them when it feels natural!` : '';
            const transferInstruction = "You can send the user a 'transfer' of money. To do this, reply with the format [transfer:AMOUNT:NOTES], where AMOUNT is a number (e.g., 10.50) and NOTES are optional text. For example: [transfer:20:Here's the money I owe you]. Only generate a transfer when it's a logical part of the conversation.";
            const descriptiveMessageInstruction = "You can also send descriptive images and locations. To send an image, use the format [image: A description of the image]. To send a location, use [location: Name of the location].";
            const systemInstruction = `${character.systemInstruction} ${nicknameInstruction} ${CHAT_STYLE_INSTRUCTION} ${stickerInstruction} ${transferInstruction} ${descriptiveMessageInstruction}`;

            chatInstances.current[configKey] = getAi().chats.create({
                model: apiConfig.model,
                history: history,
                config: { systemInstruction: systemInstruction, temperature: apiConfig.temperature },
            });
        }
        return chatInstances.current[configKey];
    }, [apiKeys, activeApiKeyId, apiConfig, customStickers, userName]);
    
    const handleSendMessage = async (characterId: string, payload: ChatMessagePayload) => {
        const character = characters.find(c => c.id === characterId);
        if (!character) return;
    
        if (!activeApiKeyId || apiKeys.length === 0) {
            alert("Please add and select an API Key in the 'Me' tab before starting a chat.");
            return;
        }

        const newUserMessage: ChatMessage = {
            id: `msg_${Date.now()}`,
            characterId: characterId,
            role: 'user',
            payload,
            timestamp: Date.now()
        };

        await db.chats.put(newUserMessage);
        setChats(prev => ({ ...prev, [characterId]: [...(prev[characterId] || []), newUserMessage] }));
    
        let textForApi = '';
        switch (payload.type) {
            case 'text': textForApi = payload.content; break;
            case 'sticker': textForApi = `[User sent a sticker]`; break;
            case 'transfer': textForApi = `[User sent you a transfer of ¥${payload.amount.toFixed(2)}]`; break;
            case 'image': textForApi = `[User sent an image: ${payload.description}]`; break;
            case 'location': textForApi = `[User sent a location: ${payload.name}]`; break;
        }

        const pendingMessageId = `msg_${Date.now()}_pending`;
        const pendingMessage: ChatMessage = {id: pendingMessageId, role: 'model', payload: {type: 'text', content: ''}, timestamp: Date.now(), characterId};
        setChats(prev => ({...prev, [characterId]: [...prev[characterId], pendingMessage]}));

        try {
            const chat = await getChat(character);
            const result = await chat.sendMessageStream({ message: textForApi });

            let messageBuffer = '';
            let firstChunkReceived = false;

            for await (const chunk of result) {
                 if (!firstChunkReceived) {
                    firstChunkReceived = true;
                    setChats(prev => {
                        const newChats = { ...prev };
                        const chatHistory = [...(newChats[characterId] || [])];
                        const pendingMsgIndex = chatHistory.findIndex(m => m.id === pendingMessageId);
                        if (pendingMsgIndex !== -1) {
                             const updatedMsg = { ...chatHistory[pendingMsgIndex] };
                             updatedMsg.payload = { type: 'text', content: ' ' };
                             chatHistory[pendingMsgIndex] = updatedMsg;
                             newChats[characterId] = chatHistory;
                        }
                        return newChats;
                    });
                }
                
                messageBuffer += chunk.text;
            }

            const finalMessagesToSave: ChatMessage[] = [];
            const parts = messageBuffer.split(MULTI_MESSAGE_SEPARATOR).map(p => p.trim()).filter(Boolean);
            
            parts.forEach((part, index) => {
                let payload: ChatMessagePayload;
                const stickerMatch = part.match(/\[sticker:(.*?)\]/);
                const transferMatch = part.match(/\[transfer:(.*?):(.*?)\]/);
                const imageMatch = part.match(/\[image:(.*?)\]/);
                const locationMatch = part.match(/\[location:(.*?)\]/);

                if (stickerMatch) {
                    const stickerName = stickerMatch[1].trim();
                    const sticker = customStickers.find(s => s.name === stickerName);
                    payload = sticker ? { type: 'sticker', stickerId: sticker.id } : { type: 'text', content: part };
                } else if (transferMatch) {
                    payload = { type: 'transfer', amount: parseFloat(transferMatch[1]), notes: transferMatch[2] };
                } else if (imageMatch) {
                    payload = { type: 'image', description: imageMatch[1].trim() };
                } else if (locationMatch) {
                    payload = { type: 'location', name: locationMatch[1].trim() };
                } else {
                    payload = { type: 'text', content: part };
                }

                finalMessagesToSave.push({
                    id: `msg_${Date.now()}_${index}`,
                    characterId,
                    role: 'model',
                    payload,
                    timestamp: Date.now() + index, // ensure order
                });
            });

            await db.chats.bulkPut(finalMessagesToSave);
            setChats(prev => {
                let chatHistory = (prev[characterId] || []).filter(m => m.id !== pendingMessageId);
                return { ...prev, [characterId]: [...chatHistory, ...finalMessagesToSave] };
            });


        } catch (error) {
            console.error("Error sending message:", error);
            let errorMessage = "Sorry, something went wrong. Please check your model settings and API key, then try again.";
            if (error.message?.includes("API key not valid")) {
                errorMessage = "Your active API Key appears to be invalid. Please update it in the 'Me' tab.";
            } else if (error.message?.includes("API Key not set")) {
                errorMessage = "Please add and select an API Key in the 'Me' tab.";
            }
            
            const errorMsg: ChatMessage = { ...pendingMessage, id: pendingMessageId, payload: { type: 'text', content: errorMessage } };
            await db.chats.put(errorMsg);
            setChats(prev => {
                const newChats = { ...prev };
                const index = newChats[characterId].findIndex(m => m.id === pendingMessageId);
                if (index > -1) newChats[characterId][index] = errorMsg;
                else newChats[characterId].push(errorMsg);
                return newChats;
            });
        }
    };

    const handleDeleteMessage = async (characterId: string, messageId: string) => {
        await db.chats.delete(messageId);
        setChats(prev => {
            const newChats = { ...prev };
            newChats[characterId] = (newChats[characterId] || []).filter(m => m.id !== messageId);
            return newChats;
        });
        chatInstances.current = {}; // Invalidate chat history
    };

    const handleEditMessage = async (characterId: string, messageId: string, newContent: string) => {
        const message = await db.chats.get(messageId);
        if (message && message.payload.type === 'text') {
            const updatedMessage: ChatMessage = {
                ...message,
                payload: { type: 'text', content: newContent },
                edited: true,
            };
            await db.chats.put(updatedMessage);
            setChats(prev => {
                const newChats = { ...prev };
                const chatHistory = [...(newChats[characterId] || [])];
                const msgIndex = chatHistory.findIndex(m => m.id === messageId);
                if (msgIndex !== -1) {
                    chatHistory[msgIndex] = updatedMessage;
                }
                newChats[characterId] = chatHistory;
                return newChats;
            });
            chatInstances.current = {}; // Invalidate chat history
        }
    };


    const generateAiContent = async (prompt: string): Promise<string> => {
        if (!activeApiKeyId || apiKeys.length === 0) {
            throw new Error("API Key not set.");
        }
        try {
            const response = await getAi().models.generateContent({
                model: apiConfig.model,
                contents: prompt,
                config: { temperature: apiConfig.temperature },
            });
            return response.text;
        } catch (error) {
            console.error("Error generating content:", error);
            if (error.message?.includes("API key not valid")) {
                throw new Error("Your active API Key appears to be invalid. Please update it in the 'Me' tab.");
            }
            throw error;
        }
    };

    const handleLikePost = async (postId: string, likerId: string) => {
        const targetPost = posts.find(p => p.id === postId);
        if (!targetPost) return;

        let newLikes = [...targetPost.likes];
        const isLiked = newLikes.includes(likerId);

        if (isLiked && likerId === USER_ID) {
            newLikes = newLikes.filter(id => id !== likerId); // Unlike
        } else if (!isLiked) {
            newLikes.push(likerId); // Like
        }
        
        const updatedPost = { ...targetPost, likes: newLikes };
        await db.posts.put(updatedPost);
        setPosts(prevPosts => prevPosts.map(p => p.id === postId ? updatedPost : p));
    };
    
    const generateActivityForPost = async (post: MomentPost) => {
        const author = allPersonas[post.authorId];
        if (!author) return;

        const authorCharacter = characters.find(c => c.id === post.authorId);
        const authorPersonaDescription = authorCharacter
            ? `The post is from ${author.name}, whose persona is: "${authorCharacter.systemInstruction}".`
            : `The post is from ${userName}, the user of the app.`;

        const potentialCommenters = characters.filter(c => c.id !== post.authorId);

        // Generate Comments
        for (const commenter of potentialCommenters) {
            if (Math.random() > 0.65) { // 35% chance
                const prompt = `You are ${commenter.name}. Your persona is: "${commenter.systemInstruction}". ${authorPersonaDescription} The post content is: "${post.content}". Write a short, in-character comment about this post. Keep it brief and conversational, like a real social media comment.`;

                setTimeout(async () => {
                    try {
                        const commentContent = await generateAiContent(prompt);
                        if (commentContent && commentContent.trim() !== '') {
                            const newComment: Comment = { id: `comment_${Date.now()}_${commenter.id}`, authorId: commenter.id, content: commentContent };
                            
                            const currentPost = await db.posts.get(post.id);
                            if (currentPost) {
                                const updatedPost = { ...currentPost, comments: [...currentPost.comments, newComment] };
                                await db.posts.put(updatedPost);
                                setPosts(prevPosts => prevPosts.map(p => p.id === post.id ? updatedPost : p));
                            }
                        }
                    } catch (error) {
                        console.error(`Failed to generate comment for ${commenter.name}`, error.message);
                    }
                }, Math.random() * 10000 + 5000);
            }
        }

        // Generate Likes
        const potentialLikers = characters.filter(c => c.id !== post.authorId);
        for (const liker of potentialLikers) {
            if (Math.random() > 0.4) { // 60% chance
                setTimeout(() => {
                    handleLikePost(post.id, liker.id);
                }, Math.random() * 8000 + 4000);
            }
        }
    };

    const handleGenerateMoment = async (characterId: string) => {
        setShowSelectAuthorModal(false);
        if (!activeApiKeyId || apiKeys.length === 0) {
            alert("Please set your API Key in the 'Me' tab to generate moments.");
            return;
        }
        const character = characters.find(c => c.id === characterId);
        if (!character) return;

        const prompt = `You are ${character.name}. Your persona is: "${character.systemInstruction}". Write a short, interesting social media post for your "Moments" feed. It could be about your day, a thought, or an observation.`;

        try {
            const content = await generateAiContent(prompt);
            const newPost: MomentPost = {
                id: `post_${Date.now()}`,
                authorId: character.id,
                content: content,
                timestamp: new Date().toLocaleString(),
                comments: [],
                likes: [],
            };
            await db.posts.put(newPost);
            setPosts(prev => [newPost, ...prev]);
            generateActivityForPost(newPost);
        } catch (error) {
            alert(`Failed to generate a moment: ${error.message}`);
        }
    };

    const handleAddUserPost = async (content: string) => {
        const newPost: MomentPost = {
            id: `post_${Date.now()}`,
            authorId: USER_ID,
            content: content,
            timestamp: new Date().toLocaleString(),
            comments: [],
            likes: [],
        };
        await db.posts.put(newPost);
        setPosts(prev => [newPost, ...prev]);
        setShowAddPostModal(false);
        if (activeApiKeyId) {
            generateActivityForPost(newPost);
        }
    };

    const handleAddComment = async (postId: string, commentText: string) => {
        const newComment: Comment = {
            id: `comment_${Date.now()}`,
            authorId: USER_ID,
            content: commentText,
        };
        const targetPost = posts.find(p => p.id === postId);
        if (!targetPost) return;
        
        const updatedPost = {...targetPost, comments: [...targetPost.comments, newComment]};
        await db.posts.put(updatedPost);
        setPosts(prev => prev.map(p => p.id === postId ? updatedPost : p));
        
        if (activeApiKeyId) {
            generateActivityForPost(targetPost);
        }
    };

    const handleAddCharacter = async (name: string, avatarUrl: string, instruction: string) => {
        const id = `char_${Date.now()}`;
        const newCharacter: Character = {
            id,
            name,
            avatarUrl: avatarUrl || `https://api.dicebear.com/8.x/bottts/svg?seed=${name}`,
            systemInstruction: instruction,
        };
        await db.characters.put(newCharacter);
        setCharacters(prev => [...prev, newCharacter]);
        setChats(prev => ({ ...prev, [id]: [] }));
        setShowAddCharacterModal(false);
    };

    const handleEditCharacter = async (id: string, name: string, avatarUrl: string, instruction: string, chatBackgroundUrl?: string, nicknameForUser?: string, autoReplyDelay?: number) => {
        const updatedCharacter = { ...characters.find(c => c.id === id)!, name, avatarUrl, systemInstruction: instruction, chatBackgroundUrl, nicknameForUser, autoReplyDelay };
        await db.characters.put(updatedCharacter);
        setCharacters(prev => prev.map(c => c.id === id ? updatedCharacter : c));
        setCharacterToEditId(null);
        chatInstances.current = {};
    }
    
    const handleDeleteCharacter = async (id: string) => {
        if (!window.confirm("Are you sure you want to delete this character? All associated chats, posts, and comments will be permanently removed.")) {
            return;
        }
        
        await db.transaction('rw', db.characters, db.chats, db.posts, async () => {
             // 1. Remove character
            await db.characters.delete(id);

            // 2. Remove chat history
            await db.chats.where('characterId').equals(id).delete();

            // 3. Remove posts, and clean comments/likes from other posts
            await db.posts.where('authorId').equals(id).delete();
            const remainingPosts = await db.posts.toArray();
            const postsToUpdate = remainingPosts.map(post => ({
                ...post,
                comments: post.comments.filter(c => c.authorId !== id),
                likes: post.likes.filter(likerId => likerId !== id),
            }));
            await db.posts.bulkPut(postsToUpdate);
        });

        // Update state
        setCharacters(prev => prev.filter(c => c.id !== id));
        setChats(prev => {
            const newChats = { ...prev };
            delete newChats[id];
            return newChats;
        });
        setPosts(prev => {
            const postsWithoutAuthor = prev.filter(p => p.authorId !== id);
            return postsWithoutAuthor.map(post => ({
                ...post,
                comments: post.comments.filter(c => c.authorId !== id),
                likes: post.likes.filter(likerId => likerId !== id),
            }));
        });
        chatInstances.current = {};
        if (activeChatCharacterId === id) setActiveChatCharacterId(null);
        if (characterToEditId === id) setCharacterToEditId(null);
    };


    const handleSaveApiConfig = async (newConfig: ApiConfig) => {
        setApiConfig(newConfig);
        await db.settings.put({key: 'apiConfig', value: newConfig});
        chatInstances.current = {};
    };
    
    const handleSetTheme = async (theme: Theme) => {
        setTheme(theme);
        await db.settings.put({ key: 'chatTheme', value: theme });
    }
    
    const handleSetMomentsBg = async (bg: string | null) => {
        setMomentsBackground(bg);
        await db.settings.put({ key: 'momentsBackground', value: bg });
    }

    const handleAddSticker = async (name: string, imageUrl: string) => {
        const newSticker: CustomSticker = { id: `sticker_${Date.now()}`, name, imageUrl };
        await db.customStickers.put(newSticker);
        setCustomStickers(prev => [...prev, newSticker]);
        setShowAddStickerModal(false);
    };

    const handleDeleteSticker = async (id: string) => {
        await db.customStickers.delete(id);
        setCustomStickers(prev => prev.filter(s => s.id !== id));
    };

    const handleExportData = async () => {
        const allData = await db.transaction('r', db.tables, async () => {
            const data = {};
            for (const table of db.tables) {
                data[table.name] = await table.toArray();
            }
            return data;
        });

        const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gemini_chat_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target?.result as string);
                await db.transaction('rw', db.tables, async () => {
                    // Clear existing data
                    for (const table of db.tables) {
                        await table.clear();
                    }
                    // Import new data
                    for (const tableName in data) {
                        if (db[tableName]) {
                            await db[tableName].bulkPut(data[tableName]);
                        }
                    }
                });
                alert("Data imported successfully! The application will now reload.");
                window.location.reload();
            } catch (error) {
                alert("Failed to import data. The file might be corrupted or in the wrong format.");
                console.error("Import error:", error);
            }
        };
        reader.readAsText(file);
    };

    const triggerAutoReply = useCallback(async (characterId: string) => {
        if (autoReplyingRef.current.has(characterId)) return;
    
        const character = characters.find(c => c.id === characterId);
        if (!character || !character.autoReplyDelay || character.autoReplyDelay <= 0) return;
    
        try {
            autoReplyingRef.current.add(characterId);
            
            console.log(`Sending auto-reply to ${character.name}`);
            const pendingMessageId = `msg_${Date.now()}_pending_auto`;
            const pendingMessage: ChatMessage = {id: pendingMessageId, role: 'model', payload: {type: 'text', content: ''}, timestamp: Date.now(), characterId};
            setChats(prev => ({...prev, [characterId]: [...(prev[characterId] || []), pendingMessage]}));
    
            const chat = await getChat(character);
            const autoReplyPrompt = "[SYSTEM_NOTE: The user has not responded for a while. Send a short, in-character follow-up message to re-engage them. You can ask a question or start a new, related topic. Do not mention that this is an automated message or a system prompt.]";
            const result = await chat.sendMessageStream({ message: autoReplyPrompt });
    
            let messageBuffer = '';
            let firstChunkReceived = false;
            for await (const chunk of result) {
                if (!firstChunkReceived) {
                    firstChunkReceived = true;
                    setChats(prev => {
                        const newChats = { ...prev };
                        const chatHistory = [...(newChats[characterId] || [])];
                        const pendingMsgIndex = chatHistory.findIndex(m => m.id === pendingMessageId);
                        if (pendingMsgIndex !== -1) {
                             const updatedMsg = { ...chatHistory[pendingMsgIndex], payload: { type: 'text', content: ' ' } as const };
                             chatHistory[pendingMsgIndex] = updatedMsg;
                             newChats[characterId] = chatHistory;
                        }
                        return newChats;
                    });
                }
                messageBuffer += chunk.text;
            }
    
            const finalMessagesToSave: ChatMessage[] = [];
            const parts = messageBuffer.split(MULTI_MESSAGE_SEPARATOR).map(p => p.trim()).filter(Boolean);
            parts.forEach((part, index) => {
                let payload: ChatMessagePayload;
                const stickerMatch = part.match(/\[sticker:(.*?)\]/);
                const transferMatch = part.match(/\[transfer:(.*?):(.*?)\]/);
                const imageMatch = part.match(/\[image:(.*?)\]/);
                const locationMatch = part.match(/\[location:(.*?)\]/);
    
                if (stickerMatch) {
                    const stickerName = stickerMatch[1].trim();
                    const sticker = customStickers.find(s => s.name === stickerName);
                    payload = sticker ? { type: 'sticker', stickerId: sticker.id } : { type: 'text', content: part };
                } else if (transferMatch) {
                    payload = { type: 'transfer', amount: parseFloat(transferMatch[1]), notes: transferMatch[2] };
                } else if (imageMatch) {
                    payload = { type: 'image', description: imageMatch[1].trim() };
                } else if (locationMatch) {
                    payload = { type: 'location', name: locationMatch[1].trim() };
                } else {
                    payload = { type: 'text', content: part };
                }
    
                finalMessagesToSave.push({
                    id: `msg_${Date.now()}_auto_${index}`,
                    characterId,
                    role: 'model',
                    payload,
                    timestamp: Date.now() + index,
                });
            });
    
            if (finalMessagesToSave.length > 0) {
                await db.chats.bulkPut(finalMessagesToSave);
                setChats(prev => {
                    let chatHistory = (prev[characterId] || []).filter(m => m.id !== pendingMessageId);
                    return { ...prev, [characterId]: [...chatHistory, ...finalMessagesToSave] };
                });
            } else {
                setChats(prev => ({ ...prev, [characterId]: (prev[characterId] || []).filter(m => m.id !== pendingMessageId) }));
            }
    
        } catch (error) {
            console.error(`Error sending auto-reply to ${characterId}:`, error);
            setChats(prev => ({ ...prev, [characterId]: (prev[characterId] || []).filter(m => !m.id.includes('_pending_auto')) }));
        } finally {
            autoReplyingRef.current.delete(characterId);
        }
    }, [characters, getChat, customStickers]);

    useEffect(() => {
        const checkIdleChats = () => {
            for (const char of characters) {
                if (char.autoReplyDelay && char.autoReplyDelay > 0) {
                    const chatHistory = chats[char.id] || [];
                    if (chatHistory.length > 0) {
                        const lastMessage = chatHistory[chatHistory.length - 1];
                        if (lastMessage.role === 'model') {
                            const timeSinceLastMessage = Date.now() - lastMessage.timestamp;
                            const delayInMillis = char.autoReplyDelay * 60 * 1000;
    
                            if (timeSinceLastMessage > delayInMillis) {
                                triggerAutoReply(char.id);
                            }
                        }
                    }
                }
            }
        };
    
        const intervalId = setInterval(checkIdleChats, 60000); 
        return () => clearInterval(intervalId);
    }, [characters, chats, triggerAutoReply]);
    
    if (!isDbLoaded) {
        return <div className="loading-screen">Loading...</div>
    }

    const activeCharacter = characters.find(c => c.id === activeChatCharacterId);
    const characterToEdit = characters.find(c => c.id === characterToEditId);
    
    const activeCharacterForBg = characters.find(c => c.id === activeChatCharacterId);
    const activeChatBg = activeCharacterForBg?.chatBackgroundUrl;

    const renderContent = () => {
        if (characterToEdit) {
            return <CharacterDetailsView character={characterToEdit} onSave={handleEditCharacter} onBack={() => setCharacterToEditId(null)} userName={userName} onDelete={handleDeleteCharacter} />;
        }
        if (activeChatCharacterId && activeCharacter) {
            return (
                <ChatView
                    character={activeCharacter}
                    messages={chats[activeChatCharacterId] || []}
                    onSendMessage={handleSendMessage}
                    onBack={() => setActiveChatCharacterId(null)}
                    onShowDetails={() => setCharacterToEditId(activeChatCharacterId)}
                    userAvatar={userAvatar}
                    customStickers={customStickers}
                    onAddSticker={() => setShowAddStickerModal(true)}
                    onDeleteSticker={handleDeleteSticker}
                    onDeleteMessage={handleDeleteMessage}
                    onEditMessage={handleEditMessage}
                />
            );
        }
        switch (currentView) {
            case 'chats': return <ChatListView characters={characters} chats={chats} onSelectChat={setActiveChatCharacterId} onAdd={() => setCurrentView('add-menu')} />;
            case 'contacts': return <ContactsView characters={characters} onSelectChat={setActiveChatCharacterId} />;
            case 'moments': return <MomentsView personas={allPersonas} posts={posts} onAddComment={handleAddComment} onAddPost={() => setShowAddPostModal(true)} onGenerate={() => setShowSelectAuthorModal(true)} userName={userName} userAvatar={userAvatar} momentsBackground={momentsBackground} onLikePost={(postId) => handleLikePost(postId, USER_ID)} />;
            case 'me': return <SettingsView currentConfig={apiConfig} onSaveApiConfig={handleSaveApiConfig} apiKeys={apiKeys} activeApiKeyId={activeApiKeyId} onDeleteApiKey={handleDeleteApiKey} onSetActiveApiKey={handleSetActiveApiKey} userName={userName} userAvatar={userAvatar} onSaveUserName={handleSaveUserName} onSaveUserAvatar={handleSaveUserAvatar} onImport={handleImportData} onExport={handleExportData} onSetMomentsBackground={handleSetMomentsBg} onAddApiKey={() => setShowAddApiKeyModal(true)} currentTheme={theme} onThemeChange={handleSetTheme} />;
            case 'add-menu': return <AddMenuView onBack={() => setCurrentView('chats')} onAddCharacter={() => setShowAddCharacterModal(true)} onAddApiKey={() => setShowAddApiKeyModal(true)} />;
            default: return <ChatListView characters={characters} chats={chats} onSelectChat={setActiveChatCharacterId} onAdd={() => setCurrentView('add-menu')} />;
        }
    };

    return (
        <div className={`app-container theme-${theme}`}>
            <style>{`
        ${activeChatBg ? `
          .chat-view[data-character-id="${activeChatCharacterId}"] .messages-container {
            background-image: url("${activeChatBg}");
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
          }
        ` : ''}
      `}</style>
            {renderContent()}
            {!activeChatCharacterId && !characterToEditId && currentView !== 'add-menu' && <BottomNav activeView={currentView} onViewChange={setCurrentView} />}
            {showAddCharacterModal && <AddCharacterModal onClose={() => setShowAddCharacterModal(false)} onSave={handleAddCharacter} />}
            {showAddPostModal && <AddPostModal onClose={() => setShowAddPostModal(false)} onSave={handleAddUserPost} />}
            {showAddApiKeyModal && <AddApiKeyModal onClose={() => setShowAddApiKeyModal(false)} onSave={handleSaveApiKey} />}
            {showAddStickerModal && <AddStickerModal onClose={() => setShowAddStickerModal(false)} onSave={handleAddSticker} />}
            {showSelectAuthorModal && <SelectPostAuthorModal characters={characters} onClose={() => setShowSelectAuthorModal(false)} onSelect={handleGenerateMoment} />}
        </div>
    );
};

// --- COMPONENTS ---

const Header: React.FC<{ title: string; onBack?: () => void; onAction?: () => void; actionIcon?: 'add' | 'info' | 'camera' | 'search', className?: string }> = ({ title, onBack, onAction, actionIcon, className }) => {
    const icons = {
        add: <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>,
        info: <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>,
        camera: <svg viewBox="0 0 24 24"><path d="M14.12 4l1.83 2H20v12H4V6h4.05l1.83-2h4.24M15 2H9L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2zm-3 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3-1.35 3-3 3z"></path></svg>,
        search: <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>,
    };
    return (
        <header className={`header ${className || ''}`}>
            {onBack && <button onClick={onBack} className="header-button back-button">&lt;</button>}
            <span>{title}</span>
            {onAction && actionIcon && <button onClick={onAction} className="header-button action-button">{icons[actionIcon]}</button>}
        </header>
    );
};

const ChatListView: React.FC<{ characters: Character[]; chats: Record<string, ChatMessage[]>; onSelectChat: (id: string) => void; onAdd: () => void; }> = ({ characters, chats, onSelectChat, onAdd }) => {
    const getLastMessage = (characterId: string) => {
        const chat = chats[characterId];
        if (!chat || chat.length === 0) return "No messages yet.";
        const lastMsg = [...chat].reverse().find(m => m.payload.type !== 'text' || m.payload.content.trim());
        return getMessageContentAsString(lastMsg);
    };
    return (
        <>
            <Header title="Chats" onAction={onAdd} actionIcon="add" />
            <main className="main-content"><ul className="chat-list">{characters.map(char => (
                <li key={char.id} className="chat-list-item" onClick={() => onSelectChat(char.id)}>
                    <img src={char.avatarUrl} alt={char.name} className="avatar" />
                    <div className="chat-info">
                        <h3>{char.name}</h3>
                        <p>{getLastMessage(char.id)}</p>
                    </div>
                </li>
            ))}</ul></main>
        </>
    );
};

const ContactsView: React.FC<{ characters: Character[]; onSelectChat: (id: string) => void; }> = ({ characters, onSelectChat }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const sortedCharacters = [...characters].sort((a, b) => a.name.localeCompare(b.name));

    const filteredCharacters = sortedCharacters.filter(character =>
        character.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {showSearch ? (
                <div className="search-header-active">
                    <div className="search-input-wrapper-active">
                        <input
                            type="text"
                            placeholder="Search"
                            className="search-input-active"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <button onClick={() => { setShowSearch(false); setSearchQuery(''); }} className="cancel-search-btn">Cancel</button>
                </div>
            ) : (
                <Header title="Contacts" onAction={() => setShowSearch(true)} actionIcon="search" />
            )}
            <main className="main-content contact-list-main">
                <ul className="chat-list">
                    {filteredCharacters.map(char => (
                        <li key={char.id} className="chat-list-item" onClick={() => onSelectChat(char.id)}>
                            <img src={char.avatarUrl} alt={char.name} className="avatar" />
                            <div className="chat-info">
                                <h3>{char.name}</h3>
                            </div>
                        </li>
                    ))}
                </ul>
            </main>
        </div>
    );
};

const ChatMessageContent: React.FC<{ message: ChatMessage; stickers: CustomSticker[]; }> = ({ message, stickers }) => {
    const { payload, role } = message;

    switch (payload.type) {
        case 'text':
            return <>{payload.content}</>;
        case 'sticker': {
            const sticker = stickers.find(s => s.id === payload.stickerId);
            return sticker ? <img src={sticker.imageUrl} alt={sticker.name} className="sticker-in-chat" /> : '[Sticker not found]';
        }
        case 'image':
            return (
                <div className="descriptive-image-bubble">
                    <div className="descriptive-image-icon">
                        <svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
                            <path d="M811.272038 156.318208l-595.873246 0c-46.818305 0-85.124749 38.306444-85.124749 85.124749l0 535.616884c0 46.818305 38.306444 85.124749 85.124749 85.124749l595.873246 0c46.818305 0 85.124749-38.306444 85.124749-85.124749l0-535.616884C896.396787 194.624652 858.090343 156.318208 811.272038 156.318208zM318.595129 255.961626c42.952254 0 77.771271 34.819017 77.771271 77.771271s-34.819017 77.771271-77.771271 77.771271-77.771271-34.819017-77.771271-77.771271S275.642874 255.961626 318.595129 255.961626zM215.398792 734.497467l148.9678-197.609637 106.405425 127.687124 148.968823-191.530175 191.530175 261.45371L215.398792 734.49849z"></path>
                        </svg>
                    </div>
                    <p>{payload.description}</p>
                </div>
            );
        case 'location':
             return (
                <div className="location-bubble-wechat">
                    <div className="location-bubble-text">
                        <h5>{payload.name}</h5>
                    </div>
                    <div className="location-bubble-map-preview">
                        <svg viewBox="0 0 24 24" className="location-pin-icon">
                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"></path>
                        </svg>
                    </div>
                </div>
            );
        case 'transfer': {
            const isSent = role === 'user';
            const transferNote = payload.notes || (isSent ? 'Transfer to friend' : 'Transfer from friend');
            return (
                <div className={`transfer-bubble ${isSent ? 'sent' : 'received'}`}>
                    <div className="transfer-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path>
                        </svg>
                    </div>
                    <div className="transfer-details">
                        <span className="transfer-amount">¥{payload.amount.toFixed(2)}</span>
                        <span className="transfer-note">{transferNote}</span>
                    </div>
                </div>
            );
        }
        default:
            return null;
    }
};

const StickerPanel: React.FC<{ stickers: CustomSticker[]; onSelectSticker: (sticker: CustomSticker) => void; onAddSticker: () => void; onDeleteSticker: (id: string) => void; isOpen: boolean; }> = ({ stickers, onSelectSticker, onAddSticker, onDeleteSticker, isOpen }) => {
    const [editMode, setEditMode] = useState(false);
    return (
        <div className={`sticker-panel ${isOpen ? 'open' : ''}`}>
            <div className="sticker-panel-header">
                <button className="sticker-panel-action-btn" onClick={() => setEditMode(!editMode)}>{editMode ? 'Done' : 'Manage'}</button>
            </div>
            <div className="sticker-grid-chat">
                {stickers.map(sticker => (
                    <div key={sticker.id} className="sticker-item-chat" onClick={() => !editMode && onSelectSticker(sticker)}>
                        <img src={sticker.imageUrl} alt={sticker.name} />
                        {editMode && <button className="delete-sticker-btn" onClick={(e) => { e.stopPropagation(); onDeleteSticker(sticker.id); }}>&times;</button>}
                    </div>
                ))}
                <button className="add-sticker-btn-chat" onClick={onAddSticker}>+</button>
            </div>
        </div>
    );
};

const ActionsPanel: React.FC<{ onAction: (action: 'transfer' | 'image' | 'location') => void; isOpen: boolean; }> = ({ onAction, isOpen }) => {
    return (
        <div className={`actions-panel ${isOpen ? 'open' : ''}`}>
            <div className="actions-grid">
                 <div className="action-item" onClick={() => onAction('image')}>
                    <div className="action-icon-wrapper"><svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9-2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"></path></svg></div>
                    <span className="action-label">Image</span>
                </div>
                <div className="action-item" onClick={() => onAction('transfer')}>
                    <div className="action-icon-wrapper transfer-icon-bg"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 2v2.51c-.63-.33-1.31-.51-2-.51-2.76 0-5 2.24-5 5s2.24 5 5 5c.69 0 1.37-.18 2-.51V20H4V8h16zM18 15c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"></path></svg></div>
                    <span className="action-label">Transfer</span>
                </div>
                 <div className="action-item" onClick={() => onAction('location')}>
                    <div className="action-icon-wrapper"><svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"></path></svg></div>
                    <span className="action-label">Location</span>
                </div>
            </div>
        </div>
    );
};

const TransferModal: React.FC<{ character: Character; onClose: () => void; onSend: (amount: number, notes: string) => void; }> = ({ character, onClose, onSend }) => {
    const [amount, setAmount] = useState('');
    const [notes, setNotes] = useState('');

    const handleSend = () => {
        const parsedAmount = parseFloat(amount);
        if (!isNaN(parsedAmount) && parsedAmount > 0) {
            onSend(parsedAmount, notes);
        } else {
            alert("Please enter a valid amount.");
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content transfer-modal-content" onClick={e => e.stopPropagation()}>
                <div className="transfer-modal-header">
                    <button className="close-btn" onClick={onClose}>&times;</button>
                    <span>Transfer to {character.name}</span>
                </div>
                <div className="transfer-modal-body">
                    <img src={character.avatarUrl} alt={character.name} className="avatar transfer-recipient-avatar" />
                    <div className="form-group transfer-amount-group">
                        <label>Amount</label>
                        <div className="amount-input-wrapper">
                            <span>¥</span>
                            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" autoFocus />
                        </div>
                    </div>
                    <div className="form-group">
                        <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes (optional)" className="notes-input" />
                    </div>
                </div>
                <div className="transfer-modal-footer">
                    <button className="save-btn-full" onClick={handleSend} disabled={!amount || parseFloat(amount) <= 0}>Transfer</button>
                </div>
            </div>
        </div>
    );
};

const DescriptionInputModal: React.FC<{ type: 'image' | 'location'; onClose: () => void; onSave: (description: string) => void; }> = ({ type, onClose, onSave }) => {
    const [description, setDescription] = useState('');
    const title = type === 'image' ? 'Send Image' : 'Send Location';
    const placeholder = type === 'image' ? 'Describe the image...' : 'Enter a place name...';

    const handleSave = () => {
        if (description.trim()) {
            onSave(description.trim());
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h2>{title}</h2>
                <div className="form-group">
                    <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={placeholder} autoFocus />
                </div>
                <div className="modal-actions">
                    <button className="cancel-btn" onClick={onClose}>Cancel</button>
                    <button className="save-btn" onClick={handleSave} disabled={!description.trim()}>Send</button>
                </div>
            </div>
        </div>
    );
};


const ChatView: React.FC<{ character: Character; messages: ChatMessage[]; onSendMessage: (characterId: string, payload: ChatMessagePayload) => void; onBack: () => void; onShowDetails: () => void; userAvatar: string; customStickers: CustomSticker[]; onAddSticker: () => void; onDeleteSticker: (id: string) => void; onDeleteMessage: (characterId: string, messageId: string) => void; onEditMessage: (characterId: string, messageId: string, newContent: string) => void; }> = ({ character, messages, onSendMessage, onBack, onShowDetails, userAvatar, customStickers, onAddSticker, onDeleteSticker, onDeleteMessage, onEditMessage }) => {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [isSending, setIsSending] = useState(false);
    const [activePanel, setActivePanel] = useState<'stickers' | 'actions' | null>(null);
    const [showTransferModal, setShowTransferModal] = useState(false);
    const [showDescriptionModal, setShowDescriptionModal] = useState<'image' | 'location' | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, message: ChatMessage } | null>(null);
    const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
    const [editText, setEditText] = useState("");

    const lastModelMessage = [...messages].reverse().find(m => m.role === 'model' && m.payload.type === 'text' && m.payload.content.includes("API Key"));
    const isErrorState = !!lastModelMessage;

    useEffect(() => {
        if (editingMessage && editingMessage.payload.type === 'text') {
            setEditText(editingMessage.payload.content);
        } else {
            setEditText("");
        }
    }, [editingMessage]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
        return () => clearTimeout(timeout);
    }, [messages, messages.length]);

    const handleSend = async () => {
        const messageToSend = input.trim();
        if (messageToSend === '' || isSending) return;
        setIsSending(true);
        setInput('');
        await onSendMessage(character.id, { type: 'text', content: messageToSend });
        setIsSending(false);
        inputRef.current?.focus();
    };

    const handleSendSticker = (sticker: CustomSticker) => {
        onSendMessage(character.id, { type: 'sticker', stickerId: sticker.id });
        setActivePanel(null);
    };

    const handleSendTransfer = (amount: number, notes: string) => {
        onSendMessage(character.id, { type: 'transfer', amount, notes });
        setShowTransferModal(false);
        setActivePanel(null);
    };

    const handleSendDescription = (description: string) => {
        if (showDescriptionModal) {
            if (showDescriptionModal === 'image') {
                onSendMessage(character.id, { type: 'image', description });
            } else if (showDescriptionModal === 'location') {
                onSendMessage(character.id, { type: 'location', name: description });
            }
        }
        setShowDescriptionModal(null);
    };

    const handleAction = (action: 'transfer' | 'image' | 'location') => {
        setActivePanel(null);
        switch (action) {
            case 'transfer': setShowTransferModal(true); break;
            case 'image': setShowDescriptionModal('image'); break;
            case 'location': setShowDescriptionModal('location'); break;
        }
    };
    
    const handleContextMenu = (e: React.MouseEvent, message: ChatMessage) => {
        if (message.role === 'user') {
            e.preventDefault();
            setContextMenu({ x: e.pageX, y: e.pageY, message });
        }
    };
    
    useEffect(() => {
        const closeMenu = () => setContextMenu(null);
        window.addEventListener('click', closeMenu);
        window.addEventListener('scroll', closeMenu, true);
        return () => {
            window.removeEventListener('click', closeMenu);
            window.removeEventListener('scroll', closeMenu, true);
        }
    }, []);

    const handleSaveEdit = () => {
        if (editingMessage && editText.trim()) {
            onEditMessage(character.id, editingMessage.id, editText.trim());
        }
        setEditingMessage(null);
    };


    return (
        <div className="chat-view" data-character-id={character.id}>
            <Header title={character.name} onBack={onBack} onAction={onShowDetails} actionIcon="info" />
            <main className="messages-container">
                {messages.map((msg, index) => {
                    const prevMsg = messages[index - 1];
                    const showTimestamp = !prevMsg || (msg.timestamp - prevMsg.timestamp > TIME_GAP_THRESHOLD);
                    
                    if (msg.payload.type === 'text' && msg.payload.content.trim() === '') return null;

                    const isSpecial = msg.payload.type !== 'text';

                    return (
                        <React.Fragment key={msg.id || index}>
                            {showTimestamp && <div className="timestamp-wrapper"><span className="timestamp">{formatTimestamp(msg.timestamp)}</span></div>}
                            <div className={`message-bubble-wrapper ${msg.role}`}>
                                <div className={`message-bubble ${msg.role} ${isSpecial ? 'special-content-bubble' : ''}`} onContextMenu={(e) => handleContextMenu(e, msg)}>
                                    <img src={msg.role === 'model' ? character.avatarUrl : userAvatar} alt={msg.role} className="avatar" />
                                     {editingMessage?.id === msg.id ? (
                                        <div className="message-content editing">
                                            <input type="text" value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()} onBlur={handleSaveEdit} />
                                            <button onClick={handleSaveEdit}>Save</button>
                                        </div>
                                    ) : (
                                        <div className="message-content">
                                            <ChatMessageContent message={msg} stickers={customStickers} />
                                            {msg.edited && <span className="edited-indicator">(edited)</span>}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </React.Fragment>
                    );
                })}
                <div ref={messagesEndRef} />
            </main>
            <footer className="chat-input-area">
                <div className="chat-input-controls">
                    <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && !isSending && !isErrorState && handleSend()} placeholder="Type a message..." disabled={isSending || isErrorState} onFocus={() => setActivePanel(null)} />
                    <button className="sticker-toggle-btn" onClick={() => setActivePanel(p => p === 'stickers' ? null : 'stickers')}>
                        <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" /></svg>
                    </button>
                    {input.trim() !== '' ? (
                        <button className="send-btn" onClick={handleSend} disabled={isSending || isErrorState || input.trim() === ''}>Send</button>
                    ) : (
                        <button className="actions-toggle-btn" onClick={() => setActivePanel(p => p === 'actions' ? null : 'actions')}>
                            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" /></svg>
                        </button>
                    )}
                </div>
                <StickerPanel stickers={customStickers} onSelectSticker={handleSendSticker} onAddSticker={onAddSticker} onDeleteSticker={onDeleteSticker} isOpen={activePanel === 'stickers'} />
                <ActionsPanel onAction={handleAction} isOpen={activePanel === 'actions'} />
            </footer>
             {contextMenu && (
                <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
                    {contextMenu.message.payload.type === 'text' && <div onClick={() => setEditingMessage(contextMenu.message)}>Edit</div>}
                    <div onClick={() => onDeleteMessage(character.id, contextMenu.message.id)}>Delete</div>
                </div>
            )}
            {showTransferModal && <TransferModal character={character} onClose={() => setShowTransferModal(false)} onSend={handleSendTransfer} />}
            {showDescriptionModal && <DescriptionInputModal type={showDescriptionModal} onClose={() => setShowDescriptionModal(null)} onSave={handleSendDescription} />}
        </div>
    );
};

const MomentsView: React.FC<{ personas: Record<string, { name: string, avatarUrl: string }>; posts: MomentPost[]; onGenerate: () => void; onAddComment: (postId: string, text: string) => void; onAddPost: () => void; userName: string; userAvatar: string; momentsBackground: string | null; onLikePost: (postId: string) => void }> = ({ personas, posts, onGenerate, onAddComment, onAddPost, userName, userAvatar, momentsBackground, onLikePost }) => {
    const [showMenu, setShowMenu] = useState(false);
    const [headerOpaque, setHeaderOpaque] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleScroll = (e: React.UIEvent<HTMLElement>) => {
        setHeaderOpaque(e.currentTarget.scrollTop > 220);
    };

    const handlePost = () => { setShowMenu(false); onAddPost(); };
    const handleGenerate = () => { setShowMenu(false); onGenerate(); };
    
    const coverPhotoStyle = {
      backgroundImage: `url(${momentsBackground || 'https://source.unsplash.com/random/800x500?nature,landscape'})`,
    };

    return (
        <div className="moments-page">
            <Header title="Moments" onAction={() => setShowMenu(s => !s)} actionIcon="camera" className={`moments-header ${headerOpaque ? 'opaque' : ''}`} />
             {showMenu &&
                <div className="moments-action-menu" ref={menuRef}>
                    <div onClick={handlePost}>Create Post</div>
                    <div onClick={handleGenerate}>Generate AI Moment</div>
                </div>
            }
            <main className="main-content moments-view" onScroll={handleScroll}>
                <div className="moments-feed-header">
                    <div className="moments-cover-photo" style={coverPhotoStyle}></div>
                     <div className="moments-user-info">
                            <span>{userName}</span>
                            <img src={userAvatar} alt="user avatar" className="avatar" />
                        </div>
                </div>
                <div className="moments-posts-list">
                    {posts.map(post => {
                        const author = personas[post.authorId];
                        if (!author) return null;
                        return <MomentPostItem key={post.id} post={post} author={author} personas={personas} onAddComment={onAddComment} onLikePost={onLikePost} />;
                    })}
                </div>
            </main>
        </div>
    );
};

const MomentPostItem: React.FC<{ post: MomentPost; author: { name: string; avatarUrl: string }; personas: Record<string, { name: string, avatarUrl: string }>; onAddComment: (postId: string, text: string) => void; onLikePost: (postId: string) => void; }> = ({ post, author, personas, onAddComment, onLikePost }) => {
    const [commentInput, setCommentInput] = useState('');
    const [showActions, setShowActions] = useState(false);
    const [isCommenting, setIsCommenting] = useState(false);
    const actionsRef = useRef<HTMLDivElement>(null);
    const commentInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) {
                setShowActions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);
    
    useEffect(() => {
        if (isCommenting) {
            commentInputRef.current?.focus();
        }
    }, [isCommenting]);

    const handleCommentSubmit = () => {
        if (commentInput.trim()) {
            onAddComment(post.id, commentInput.trim());
            setCommentInput('');
            setIsCommenting(false);
        }
    }

    const handleLikeClick = () => {
        onLikePost(post.id);
        setShowActions(false);
    }
    
    const handleCommentClick = () => {
        setIsCommenting(true);
        setShowActions(false);
    }
    
    const hasLikesOrComments = post.likes.length > 0 || post.comments.length > 0;

    return (
        <div className="moment-post">
            <div className="moment-header"><img src={author.avatarUrl} alt={author.name} className="avatar" /><h4>{author.name}</h4></div>
            <p className="moment-content">{post.content}</p>
            <div className="moment-footer">
                <span className="moment-timestamp">{post.timestamp}</span>
                <div className="moment-actions-trigger" onClick={() => setShowActions(s => !s)}>...</div>
                {showActions && (
                    <div className="moment-actions-menu" ref={actionsRef}>
                        <div className="action-item" onClick={handleLikeClick}>
                           <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
                           {post.likes.includes(USER_ID) ? 'Unlike' : 'Like'}
                        </div>
                        <div className="action-item" onClick={handleCommentClick}>
                             <svg viewBox="0 0 24 24"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"></path></svg>
                             Comment
                        </div>
                    </div>
                )}
            </div>
            {(hasLikesOrComments || isCommenting) &&
                <div className="likes-and-comments-section">
                    {post.likes.length > 0 &&
                        <div className="likes-section">
                           <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>
                            {post.likes.map((likerId, index) => (
                                <span key={likerId} className="like-author">
                                    {personas[likerId]?.name}{index < post.likes.length - 1 ? ',' : ''}
                                </span>
                            ))}
                        </div>
                    }
                    {post.comments.map(comment => {
                        const commenter = personas[comment.authorId];
                        return (
                            <div key={comment.id} className="comment-item">
                                <img src={commenter.avatarUrl} alt={commenter.name} className="avatar" />
                                <div className="comment-content">
                                    <span className="comment-author">{commenter.name}</span>
                                    <span>{comment.content}</span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            }
             {isCommenting &&
                <div className="comment-input-area">
                    <input ref={commentInputRef} type="text" placeholder="Add a comment..." value={commentInput} onChange={e => setCommentInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleCommentSubmit()} onBlur={() => {!commentInput && setIsCommenting(false)}}/>
                    <button onClick={handleCommentSubmit} disabled={!commentInput.trim()}>Send</button>
                </div>
            }
        </div>
    );
};

const AvatarUploader: React.FC<{ currentAvatar: string; onAvatarChange: (newAvatar: string) => void; className?: string }> = ({ currentAvatar, onAvatarChange, className = '' }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const handleAvatarClick = () => fileInputRef.current?.click();
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const base64 = await imageFileToBase64(file);
            onAvatarChange(base64);
        }
    };
    return (
        <div className={`avatar-uploader ${className}`} onClick={handleAvatarClick}>
            <img src={currentAvatar} alt="avatar" />
            <div className="avatar-overlay">Click to upload</div>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" style={{ display: 'none' }} />
        </div>
    );
};

const EditNameModal: React.FC<{ currentName: string; onClose: () => void; onSave: (name: string) => void; }> = ({ currentName, onClose, onSave }) => {
    const [name, setName] = useState(currentName);
    const handleSave = () => {
        if (name.trim()) {
            onSave(name.trim());
        }
    };
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h2>Edit Name</h2>
                <div className="form-group">
                    <input id="user-name-edit-input" type="text" value={name} onChange={e => setName(e.target.value)} autoFocus />
                </div>
                <div className="modal-actions">
                    <button className="cancel-btn" onClick={onClose}>Cancel</button>
                    <button className="save-btn" onClick={handleSave} disabled={!name.trim()}>Save</button>
                </div>
            </div>
        </div>
    );
};

const SettingsView: React.FC<{ currentConfig: ApiConfig; onSaveApiConfig: (config: ApiConfig) => void; apiKeys: ApiKey[]; activeApiKeyId: string | null; onDeleteApiKey: (id: string) => void; onSetActiveApiKey: (id: string) => void; userName: string; userAvatar: string; onSaveUserName: (name: string) => void; onSaveUserAvatar: (avatar: string) => void; onImport: (e: React.ChangeEvent<HTMLInputElement>) => void; onExport: () => void; onSetMomentsBackground: (bg: string | null) => void; onAddApiKey: () => void; currentTheme: Theme; onThemeChange: (theme: Theme) => void; }> = ({ currentConfig, onSaveApiConfig, apiKeys, activeApiKeyId, onDeleteApiKey, onSetActiveApiKey, userName, userAvatar, onSaveUserName, onSaveUserAvatar, onImport, onExport, onSetMomentsBackground, onAddApiKey, currentTheme, onThemeChange }) => {
    const [config, setConfig] = useState(currentConfig);
    const [showEditNameModal, setShowEditNameModal] = useState(false);
    const importRef = useRef<HTMLInputElement>(null);
    const momentsBgRef = useRef<HTMLInputElement>(null);

    useEffect(() => { setConfig(currentConfig); }, [currentConfig]);

    const handleSaveConfig = () => onSaveApiConfig(config);
    const maskKey = (key: string) => key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : key;

    const createBgHandler = (setter: (bg: string | null) => void) => async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const base64 = await imageFileToBase64(file);
                setter(base64);
            } catch (error) {
                console.error("Error converting file to Base64", error);
                alert("Could not load image.");
            }
        }
    };

    return (
        <>
            <Header title="Me" />
            <main className="main-content settings-view">
                <div className="user-profile-banner">
                    <AvatarUploader currentAvatar={userAvatar} onAvatarChange={onSaveUserAvatar} className="profile-banner-avatar" />
                    <div className="user-name-display" onClick={() => setShowEditNameModal(true)}>
                        <span>{userName}</span>
                        <svg viewBox="0 0 24 24" className="edit-icon"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
                    </div>
                </div>

                <div className="settings-section">
                    <h3>API Keys</h3>
                    <ul className="api-key-list">
                        {apiKeys.map(apiKey => (
                            <li key={apiKey.id} className="api-key-item">
                                <input type="radio" name="api-key" checked={activeApiKeyId === apiKey.id} onChange={() => onSetActiveApiKey(apiKey.id)} />
                                <div className="api-key-info">
                                    <div className="name">{apiKey.name}</div>
                                    <div className="key-preview">{maskKey(apiKey.key)}</div>
                                </div>
                                <button className="delete-key-btn" onClick={() => onDeleteApiKey(apiKey.id)}>Delete</button>
                            </li>
                        ))}
                    </ul>
                    <div className="add-key-button" onClick={onAddApiKey}>+ Add API Key</div>
                    <div className="billing-link">
                        Get your API key from <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer">Google AI Studio</a>.
                    </div>
                </div>

                <div className="settings-section">
                    <h3>Model Settings</h3>
                    <div className="settings-item">
                        <label htmlFor="model-select">Model</label>
                        <select id="model-select" value={config.model} onChange={e => setConfig({ ...config, model: e.target.value as ApiConfig['model'] })} onBlur={handleSaveConfig}>
                            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        </select>
                    </div>
                    <div className="settings-item">
                        <label>Temperature</label>
                        <div className="slider-container">
                            <span>0.0</span>
                            <input type="range" min="0" max="1" step="0.1" value={config.temperature} onChange={e => setConfig({ ...config, temperature: parseFloat(e.target.value) })} onMouseUp={handleSaveConfig} onTouchEnd={handleSaveConfig} />
                            <span>{config.temperature.toFixed(1)}</span>
                        </div>
                    </div>
                </div>

                <div className="settings-section">
                    <h3>Appearance</h3>
                    <div className="settings-item">
                        <label htmlFor="theme-select">Theme</label>
                        <select id="theme-select" value={currentTheme} onChange={e => onThemeChange(e.target.value as Theme)}>
                            <option value="wechat">WeChat</option>

                            <option value="sakura-pink">Sakura Pink</option>
                            <option value="ocean-blue">Ocean Blue</option>
                            <option value="mint-green">Mint Green</option>
                            <option value="lavender-dream">Lavender Dream</option>
                        </select>
                    </div>
                    <div className="settings-item" onClick={() => momentsBgRef.current?.click()}>
                        <span>Moments Background</span><span className="arrow">&gt;</span>
                        <input type="file" ref={momentsBgRef} style={{ display: 'none' }} accept="image/*" onChange={createBgHandler(onSetMomentsBackground)} />
                    </div>
                </div>

                <div className="settings-section">
                    <h3>Data Management</h3>
                    <div className="settings-item" onClick={() => importRef.current?.click()}><span>Import Data</span><span className="arrow">&gt;</span></div>
                    <input type="file" ref={importRef} style={{ display: 'none' }} accept=".json" onChange={onImport} />
                    <div className="settings-item" onClick={onExport}><span>Export Data</span><span className="arrow">&gt;</span></div>
                </div>
            </main>
            {showEditNameModal && <EditNameModal currentName={userName} onClose={() => setShowEditNameModal(false)} onSave={(name) => { onSaveUserName(name); setShowEditNameModal(false); }} />}
        </>
    );
};

const AddMenuView: React.FC<{ onBack: () => void; onAddCharacter: () => void; onAddApiKey: () => void; }> = ({ onBack, onAddCharacter, onAddApiKey }) => (
    <>
        <Header title="Add" onBack={onBack} />
        <main className="main-content settings-view">
            <div className="settings-section">
                <div className="settings-item" onClick={onAddCharacter}><span>Add New Character</span><span className="arrow">+</span></div>
                <div className="settings-item add-menu-api-key-btn" onClick={onAddApiKey}><span>Add New API Key</span><span className="arrow">+</span></div>
            </div>
        </main>
    </>
);

const AddCharacterModal: React.FC<{ onClose: () => void; onSave: (name: string, avatarUrl: string, instruction: string) => void; }> = ({ onClose, onSave }) => {
    const [name, setName] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');
    const [instruction, setInstruction] = useState('');
    const handleSave = () => { if (name.trim() && instruction.trim()) onSave(name.trim(), avatarUrl.trim(), instruction.trim()); };
    return (<div className="modal-overlay" onClick={onClose}><div className="modal-content" onClick={e => e.stopPropagation()}><h2>Add New Character</h2>
        <div className="form-group"><label>Avatar (Optional)</label><AvatarUploader currentAvatar={avatarUrl || `https://api.dicebear.com/8.x/bottts/svg?seed=${name || 'new'}`} onAvatarChange={setAvatarUrl} className="modal-avatar-uploader" /></div>
        <div className="form-group"><label htmlFor="char-name">Name</label><input id="char-name" type="text" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="form-group"><label htmlFor="char-instruction">System Instruction (Persona)</label><textarea id="char-instruction" value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="e.g., You are a pirate captain..."></textarea></div>
        <div className="modal-actions"><button className="cancel-btn" onClick={onClose}>Cancel</button><button className="save-btn" onClick={handleSave}>Save</button></div>
    </div></div>);
};

const CharacterDetailsView: React.FC<{ character: Character, onBack: () => void; onSave: (id: string, name: string, avatarUrl: string, instruction: string, chatBackgroundUrl?: string, nicknameForUser?: string, autoReplyDelay?: number) => void; userName: string; onDelete: (id: string) => void; }> = ({ character, onBack, onSave, userName, onDelete }) => {
    const [name, setName] = useState(character.name);
    const [avatarUrl, setAvatarUrl] = useState(character.avatarUrl);
    const [instruction, setInstruction] = useState(character.systemInstruction);
    const [backgroundUrl, setBackgroundUrl] = useState(character.chatBackgroundUrl);
    const [nickname, setNickname] = useState(character.nicknameForUser || '');
    const [autoReplyDelay, setAutoReplyDelay] = useState(character.autoReplyDelay || 0);
    const bgInputRef = useRef<HTMLInputElement>(null);

    const handleSave = () => {
        if (name.trim() && instruction.trim()) {
            onSave(character.id, name.trim(), avatarUrl.trim(), instruction.trim(), backgroundUrl, nickname.trim(), autoReplyDelay);
        }
    };

    const handleBgChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            try {
                const base64 = await imageFileToBase64(file);
                setBackgroundUrl(base64);
            } catch (error) {
                console.error("Error converting file to Base64", error);
                alert("Could not load image.");
            }
        }
    };

    return (
        <div className="details-view">
            <Header title="Character Details" onBack={onBack} />
            <main className="main-content">
                <div className="details-form">
                    <AvatarUploader currentAvatar={avatarUrl} onAvatarChange={setAvatarUrl} className="modal-avatar-uploader" />
                    <div className="form-group">
                        <label htmlFor="char-name-edit">Name</label>
                        <input id="char-name-edit" type="text" value={name} onChange={e => setName(e.target.value)} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="char-nickname-edit">Nickname for You</label>
                        <input id="char-nickname-edit" type="text" value={nickname} onChange={e => setNickname(e.target.value)} placeholder={`e.g., Captain, Boss, ${userName}`} />
                    </div>
                     <div className="form-group">
                        <label htmlFor="char-autoreply-edit">Auto-Reply Delay (minutes)</label>
                        <input id="char-autoreply-edit" type="number" min="0" value={autoReplyDelay} onChange={e => setAutoReplyDelay(parseInt(e.target.value, 10) || 0)} placeholder="0 to disable" />
                        <small className="form-group-note">Set a time for the character to message you if you're idle. Set to 0 to disable.</small>
                    </div>
                    <div className="form-group">
                        <label htmlFor="char-instruction-edit">System Instruction (Persona)</label>
                        <textarea id="char-instruction-edit" value={instruction} onChange={e => setInstruction(e.target.value)}></textarea>
                    </div>
                    <div className="settings-section details-settings-section">
                        <div className="settings-item" onClick={() => bgInputRef.current?.click()}>
                            <span>Chat Background</span>
                            <div className="background-preview-wrapper">
                                {backgroundUrl && <img src={backgroundUrl} className="background-preview" alt="background preview" />}
                                <span className="arrow">&gt;</span>
                            </div>
                            <input type="file" ref={bgInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleBgChange} />
                        </div>
                    </div>
                    <button className="save-btn-full" onClick={handleSave}>Save Changes</button>
                    <button className="delete-btn-full" onClick={() => onDelete(character.id)}>Delete Character</button>
                </div>
            </main>
        </div>);
};


const AddPostModal: React.FC<{ onClose: () => void; onSave: (content: string) => void; }> = ({ onClose, onSave }) => {
    const [content, setContent] = useState('');
    const handleSave = () => { if (content.trim()) onSave(content.trim()); };
    return (<div className="modal-overlay" onClick={onClose}><div className="modal-content" onClick={e => e.stopPropagation()}><h2>Create Post</h2><div className="form-group"><label htmlFor="post-content">What's on your mind?</label><textarea id="post-content" value={content} onChange={e => setContent(e.target.value)} placeholder="Share your thoughts..."></textarea></div><div className="modal-actions"><button className="cancel-btn" onClick={onClose}>Cancel</button><button className="save-btn" onClick={handleSave}>Post</button></div></div></div>);
};

const AddApiKeyModal: React.FC<{ onClose: () => void; onSave: (name: string, key: string) => void; }> = ({ onClose, onSave }) => {
    const [name, setName] = useState('');
    const [key, setKey] = useState('');
    const handleSave = () => { if (name.trim() && key.trim()) onSave(name.trim(), key.trim()); };
    return (<div className="modal-overlay" onClick={onClose}><div className="modal-content" onClick={e => e.stopPropagation()}><h2>Add API Key</h2><div className="form-group"><label htmlFor="key-name">Name</label><input id="key-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Personal Key" /></div><div className="form-group"><label htmlFor="key-input">API Key</label><input id="key-input" type="password" value={key} onChange={e => setKey(e.target.value)} /></div><div className="modal-actions"><button className="cancel-btn" onClick={onClose}>Cancel</button><button className="save-btn" onClick={handleSave}>Save</button></div></div></div>);
};

const AddStickerModal: React.FC<{ onClose: () => void; onSave: (name: string, imageUrl: string) => void; }> = ({ onClose, onSave }) => {
    const [name, setName] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const handleSave = () => { if (name.trim() && imageUrl) onSave(name.trim(), imageUrl); };
    return (<div className="modal-overlay" onClick={onClose}><div className="modal-content" onClick={e => e.stopPropagation()}><h2>Add Custom Sticker</h2>
        <div className="form-group"><label>Sticker Image</label><AvatarUploader currentAvatar={imageUrl || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIiB2aWV3Qm94PSIwIDAgMjQgMjQiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2NjYyIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIj48L2NpcmNsZT48bGluZSB4MT0iMTIiIHkxPSI4IiB4Mj0iMTIiIHkyPSIxNiI+PC9saW5lPjxsaW5lIHgxPSI4IiB5MT0iMTIiIHgyPSIxNiIgeTI9IjEyIj48L2xpbmU+PC9zdmc+'} onAvatarChange={setImageUrl} className="modal-avatar-uploader" /></div>
        <div className="form-group"><label htmlFor="sticker-name">Sticker Name (for AI to use)</label><input id="sticker-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., happy_cat" /></div>
        <div className="modal-actions"><button className="cancel-btn" onClick={onClose}>Cancel</button><button className="save-btn" onClick={handleSave} disabled={!name.trim() || !imageUrl}>Save</button></div>
    </div></div>);
};

const SelectPostAuthorModal: React.FC<{ characters: Character[]; onClose: () => void; onSelect: (characterId: string) => void; }> = ({ characters, onClose, onSelect }) => {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h2>Select an Author</h2>
                <ul className="select-author-list">
                    {characters.map(char => (
                        <li key={char.id} onClick={() => onSelect(char.id)}>
                            <img src={char.avatarUrl} alt={char.name} className="avatar" />
                            <span>{char.name}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

const BottomNav: React.FC<{ activeView: View; onViewChange: (view: View) => void }> = ({ activeView, onViewChange }) => (
    <nav className="bottom-nav">
        <button className={`nav-item ${activeView === 'chats' ? 'active' : ''}`} onClick={() => onViewChange('chats')}><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"></path></svg><span>Chats</span></button>
        <button className={`nav-item ${activeView === 'contacts' ? 'active' : ''}`} onClick={() => onViewChange('contacts')}><svg viewBox="0 0 24 24"><path d="M20 0H4v2h16V0zM4 24h16v-2H4v2zM20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 2.75c1.24 0 2.25 1.01 2.25 2.25S13.24 11.25 12 11.25 9.75 10.24 9.75 9 10.76 6.75 12 6.75zM17 17H7v-1.5c0-1.67 3.33-2.5 5-2.5s5 .83 5 2.5V17z"></path></svg><span>Contacts</span></button>
        <button className={`nav-item ${activeView === 'moments' ? 'active' : ''}`} onClick={() => onViewChange('moments')}><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"></path></svg><span>Moments</span></button>
        <button className={`nav-item ${activeView === 'me' ? 'active' : ''}`} onClick={() => onViewChange('me')}><svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"></path></svg><span>Me</span></button>
    </nav>
);

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);