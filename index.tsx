import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Chat, GenerateContentResponse } from "@google/genai";

// --- CONSTANTS ---
const USER_ID = 'user';
const CHAT_STYLE_INSTRUCTION = `
# Character Dialogue Guidelines

- Implicit meaning.
- Natural speech with a strong **活人感**
  - Char quirks (speech)
  - No dogma or recitation.
  - No jargon, contracts, or rules.
  - **Pauses, hesitations, repetitions** (allowed)
  - Use of onomatopoeia.
- Inarticulate or vague is fine.
- Not required to serve plot: allow rambling, digressions, silence.
- **Everyday trivialities ＞ strict logic.**

---

You are chatting online. 
Keep your replies concise and conversational, like text messages. 
Do not use action descriptions (like *smiles*) or describe your internal thoughts. 
To create a more natural chat flow, you can split your response into multiple short messages. 
Use '|||' as a separator. 

For example: 
"Hi there!|||How can I help you today?"
`;

const MULTI_MESSAGE_SEPARATOR = '|||';
const TIME_GAP_THRESHOLD = 5 * 60 * 1000; // 5 minutes


// --- TYPES ---
interface ApiKey {
    id: string;
    name: string;
    key: string;
}

interface ApiConfig {
    model: 'gemini-2.5-flash' | 'gemini-2.5-pro';
    temperature: number;
}

interface Character {
    id: string;
    name: string;
    avatarUrl: string; // Can be a URL or a Base64 string
    chatBackgroundUrl?: string; // Character-specific background
    systemInstruction: string;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    content: string;
    timestamp: number;
}

interface Comment {
    id: string;
    authorId: string; // 'user' or characterId
    content: string;
}

interface MomentPost {
    id: string;
    authorId: string; // 'user' or characterId
    content: string;
    timestamp: string;
    comments: Comment[];
}

interface CustomSticker {
    id: string;
    name: string;
    imageUrl: string; // Base64 string
}

type View = 'chats' | 'contacts' | 'moments' | 'me' | 'add-menu';
type Theme = 'wechat' | 'sakura-pink' | 'ocean-blue' | 'mint-green' | 'lavender-dream';


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

    const chatInstances = useRef<Record<string, Chat>>({});

    useEffect(() => {
        // Load everything from localStorage
        const savedTheme = localStorage.getItem('chatTheme') as Theme || 'wechat';
        setTheme(savedTheme);

        const savedName = localStorage.getItem('userName') || 'User';
        setUserName(savedName);
        const savedAvatar = localStorage.getItem('userAvatar') || `https://api.dicebear.com/8.x/initials/svg?seed=${savedName}`;
        setUserAvatar(savedAvatar);

        const savedKeys = localStorage.getItem('geminiApiKeys');
        const loadedKeys = savedKeys ? JSON.parse(savedKeys) : [];
        setApiKeys(loadedKeys);

        const savedActiveId = localStorage.getItem('activeGeminiApiKeyId');
        if (savedActiveId && loadedKeys.some(k => k.id === savedActiveId)) {
            setActiveApiKeyId(savedActiveId);
        } else if (loadedKeys.length > 0) {
            setActiveApiKeyId(loadedKeys[0].id);
        }

        const savedConfig = localStorage.getItem('apiConfig');
        if (savedConfig) setApiConfig(JSON.parse(savedConfig));

        const savedCharacters = localStorage.getItem('characters');
        const loadedCharacters = savedCharacters ? JSON.parse(savedCharacters) : INITIAL_CHARACTERS;
        setCharacters(loadedCharacters);

        const savedChats = localStorage.getItem('chats');
        const loadedChats = savedChats ? JSON.parse(savedChats) : {};
        // Add IDs and timestamps to old messages for compatibility
        Object.keys(loadedChats).forEach(charId => {
            loadedChats[charId] = loadedChats[charId].map((msg, index) => ({
                ...msg,
                id: msg.id || `loaded_${charId}_${index}`,
                timestamp: msg.timestamp || Date.now() - (loadedChats[charId].length - index) * 10000
            }));
        });
        const initialChats = {};
        loadedCharacters.forEach(c => initialChats[c.id] = loadedChats[c.id] || []);
        setChats(initialChats);

        const savedPosts = localStorage.getItem('posts');
        if (savedPosts) setPosts(JSON.parse(savedPosts));

        const savedStickers = localStorage.getItem('customStickers');
        if (savedStickers) setCustomStickers(JSON.parse(savedStickers));

        const savedMomentsBg = localStorage.getItem('momentsBackground');
        if (savedMomentsBg) setMomentsBackground(savedMomentsBg);

    }, []);

    // Save to localStorage whenever data changes
    useEffect(() => { localStorage.setItem('chatTheme', theme); }, [theme]);
    useEffect(() => { localStorage.setItem('userName', userName); }, [userName]);
    useEffect(() => { localStorage.setItem('userAvatar', userAvatar); }, [userAvatar]);
    useEffect(() => { localStorage.setItem('geminiApiKeys', JSON.stringify(apiKeys)); }, [apiKeys]);
    useEffect(() => { activeApiKeyId ? localStorage.setItem('activeGeminiApiKeyId', activeApiKeyId) : localStorage.removeItem('activeGeminiApiKeyId'); }, [activeApiKeyId]);
    useEffect(() => { localStorage.setItem('apiConfig', JSON.stringify(apiConfig)); }, [apiConfig]);
    useEffect(() => { localStorage.setItem('characters', JSON.stringify(characters)); }, [characters]);
    useEffect(() => { localStorage.setItem('chats', JSON.stringify(chats)); }, [chats]);
    useEffect(() => { localStorage.setItem('posts', JSON.stringify(posts)); }, [posts]);
    useEffect(() => { localStorage.setItem('customStickers', JSON.stringify(customStickers)); }, [customStickers]);
    useEffect(() => { momentsBackground ? localStorage.setItem('momentsBackground', momentsBackground) : localStorage.removeItem('momentsBackground'); }, [momentsBackground]);

    const getAi = useCallback(() => {
        const activeKey = apiKeys.find(k => k.id === activeApiKeyId)?.key;
        if (!activeKey) {
            throw new Error("Active API Key not set.");
        }
        return new GoogleGenAI({ apiKey: activeKey });
    }, [apiKeys, activeApiKeyId]);


    const handleSaveApiKey = (name: string, key: string) => {
        const newKey = { id: `key_${Date.now()}`, name, key };
        const newKeys = [...apiKeys, newKey];
        setApiKeys(newKeys);
        if (!activeApiKeyId) {
            setActiveApiKeyId(newKey.id);
        }
        setShowAddApiKeyModal(false);
        chatInstances.current = {};
    };

    const handleDeleteApiKey = (id: string) => {
        const newKeys = apiKeys.filter(k => k.id !== id);
        setApiKeys(newKeys);
        if (activeApiKeyId === id) {
            const newActiveId = newKeys.length > 0 ? newKeys[0].id : null;
            setActiveApiKeyId(newActiveId);
        }
        chatInstances.current = {};
    };

    const handleSetActiveApiKey = (id: string) => {
        setActiveApiKeyId(id);
        chatInstances.current = {};
    };

    const handleSaveUserName = (name: string) => {
        setUserName(name);
        // If user is using the default avatar, update it with the new name
        if (userAvatar.includes('api.dicebear.com/8.x/initials')) {
            setUserAvatar(`https://api.dicebear.com/8.x/initials/svg?seed=${name}`);
        }
    };

    const handleSaveUserAvatar = (avatar: string) => {
        setUserAvatar(avatar);
    };

    const getChat = (character: Character): Chat => {
        const activeKey = apiKeys.find(k => k.id === activeApiKeyId)?.key;
        if (!activeKey) throw new Error("Active API key not set.");

        const configKey = `${character.id}-${apiConfig.model}-${apiConfig.temperature}-${activeApiKeyId}-${customStickers.length}`;
        if (!chatInstances.current[configKey]) {
            const history = (chats[character.id] || [])
                .filter(msg => msg.content)
                .map(msg => ({
                    role: msg.role === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.content }]
                }));

            const stickerInstruction = customStickers.length > 0 ? `You have access to custom stickers. To use one, reply with its name in the format [sticker:sticker_name]. Available sticker names are: ${customStickers.map(s => s.name).join(', ')}.` : '';
            const transferInstruction = "You can send the user a 'transfer' of money. To do this, reply with the format [transfer:AMOUNT:NOTES], where AMOUNT is a number (e.g., 10.50) and NOTES are optional text. For example: [transfer:20:Here's the money I owe you]. Only generate a transfer when it's a logical part of the conversation.";
            const systemInstruction = `${character.systemInstruction} ${CHAT_STYLE_INSTRUCTION} ${stickerInstruction} ${transferInstruction}`;

            chatInstances.current[configKey] = getAi().chats.create({
                model: apiConfig.model,
                history: history,
                config: { systemInstruction: systemInstruction, temperature: apiConfig.temperature },
            });
        }
        return chatInstances.current[configKey];
    };

    const handleSendMessage = async (characterId: string, message: string) => {
        const character = characters.find(c => c.id === characterId);
        if (!character) return;

        if (!activeApiKeyId || apiKeys.length === 0) {
            alert("Please add and select an API Key in the 'Me' tab before starting a chat.");
            return;
        }

        const messageParts = message.split(MULTI_MESSAGE_SEPARATOR).map(content => content.trim()).filter(content => content);
        if (messageParts.length === 0) return;

        const userMessages: ChatMessage[] = messageParts.map(content => ({
            id: `msg_${Date.now()}_${Math.random()}`,
            role: 'user',
            content,
            timestamp: Date.now()
        }));

        setChats(prev => ({ ...prev, [characterId]: [...(prev[characterId] || []), ...userMessages] }));
        setChats(prev => ({ ...prev, [characterId]: [...(prev[characterId] || []), { id: `msg_${Date.now()}_pending`, role: 'model', content: '', timestamp: Date.now() }] }));

        try {
            const chat = getChat(character);
            const result = await chat.sendMessageStream({ message });

            let messageBuffer = '';

            for await (const chunk of result) {
                messageBuffer += chunk.text;

                setChats(prev => {
                    const newChats = JSON.parse(JSON.stringify(prev));
                    const chatHistory = newChats[characterId];
                    let lastMessage = chatHistory[chatHistory.length - 1];

                    while (messageBuffer.includes(MULTI_MESSAGE_SEPARATOR)) {
                        const parts = messageBuffer.split(MULTI_MESSAGE_SEPARATOR);
                        lastMessage.content += parts.shift();
                        messageBuffer = parts.join(MULTI_MESSAGE_SEPARATOR);

                        chatHistory.push({ id: `msg_${Date.now()}_${Math.random()}`, role: 'model', content: '', timestamp: Date.now() });
                        lastMessage = chatHistory[chatHistory.length - 1];
                    }

                    lastMessage.content = (lastMessage.content || "") + messageBuffer;
                    messageBuffer = "";

                    return newChats;
                });
            }
        } catch (error) {
            console.error("Error sending message:", error);
            let errorMessage = "Sorry, something went wrong. Please check your model settings and API key, then try again.";
            if (error.message?.includes("API key not valid")) {
                errorMessage = "Your active API Key appears to be invalid. Please update it in the 'Me' tab.";
            } else if (error.message?.includes("API Key not set")) {
                errorMessage = "Please add and select an API Key in the 'Me' tab.";
            }

            setChats(prev => {
                const newChats = { ...prev };
                const lastMessage = newChats[characterId][newChats[characterId].length - 1];
                if (lastMessage?.role === 'model') {
                    lastMessage.content = errorMessage;
                }
                return newChats;
            });
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

    const generateCommentsForPost = async (post: MomentPost) => {
        if (characters.length <= 1 && post.authorId !== USER_ID) return;
        const potentialCommenters = characters.filter(c => c.id !== post.authorId);
        if (potentialCommenters.length === 0) return;

        const commenter = potentialCommenters[Math.floor(Math.random() * potentialCommenters.length)];
        if (!commenter) return;

        const author = allPersonas[post.authorId]?.name || 'You';
        const prompt = `You are ${commenter.name}. Your persona is "${commenter.systemInstruction}". You see a post from ${author} that says: "${post.content}". Write a short, in-character comment about this post.`;

        setTimeout(async () => {
            try {
                const commentContent = await generateAiContent(prompt);
                const newComment: Comment = { id: `comment_${Date.now()}`, authorId: commenter.id, content: commentContent };
                setPosts(prevPosts => prevPosts.map(p => p.id === post.id ? { ...p, comments: [...p.comments, newComment] } : p));
            } catch (error) {
                console.error("Failed to generate comment", error.message);
            }
        }, Math.random() * 3000 + 2000);
    }

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
            };
            setPosts(prev => [newPost, ...prev]);
            generateCommentsForPost(newPost);
        } catch (error) {
            alert(`Failed to generate a moment: ${error.message}`);
        }
    };

    const handleAddUserPost = (content: string) => {
        const newPost: MomentPost = {
            id: `post_${Date.now()}`,
            authorId: USER_ID,
            content: content,
            timestamp: new Date().toLocaleString(),
            comments: [],
        };
        setPosts(prev => [newPost, ...prev]);
        setShowAddPostModal(false);
        if (activeApiKeyId) {
            generateCommentsForPost(newPost);
        }
    };

    const handleAddComment = (postId: string, commentText: string) => {
        const newComment: Comment = {
            id: `comment_${Date.now()}`,
            authorId: USER_ID,
            content: commentText,
        };
        setPosts(prev => prev.map(p => p.id === postId ? { ...p, comments: [...p.comments, newComment] } : p));
    };

    const handleAddCharacter = (name: string, avatarUrl: string, instruction: string) => {
        const id = `char_${Date.now()}`;
        const newCharacter: Character = {
            id,
            name,
            avatarUrl: avatarUrl || `https://api.dicebear.com/8.x/bottts/svg?seed=${name}`,
            systemInstruction: instruction,
        };
        setCharacters(prev => [...prev, newCharacter]);
        setChats(prev => ({ ...prev, [id]: [] }));
        setShowAddCharacterModal(false);
    };

    const handleEditCharacter = (id: string, name: string, avatarUrl: string, instruction: string, chatBackgroundUrl?: string) => {
        setCharacters(prev => prev.map(c => c.id === id ? { ...c, name, avatarUrl, systemInstruction: instruction, chatBackgroundUrl } : c));
        setCharacterToEditId(null);
        chatInstances.current = {};
    }

    const handleSaveApiConfig = (newConfig: ApiConfig) => {
        setApiConfig(newConfig);
        chatInstances.current = {};
    };

    const handleAddSticker = (name: string, imageUrl: string) => {
        const newSticker: CustomSticker = { id: `sticker_${Date.now()}`, name, imageUrl };
        setCustomStickers(prev => [...prev, newSticker]);
        setShowAddStickerModal(false);
    };

    const handleDeleteSticker = (id: string) => {
        setCustomStickers(prev => prev.filter(s => s.id !== id));
    };

    const handleExportData = () => {
        const data = {
            chatTheme: localStorage.getItem('chatTheme'),
            userName: localStorage.getItem('userName'),
            userAvatar: localStorage.getItem('userAvatar'),
            geminiApiKeys: localStorage.getItem('geminiApiKeys'),
            activeGeminiApiKeyId: localStorage.getItem('activeGeminiApiKeyId'),
            apiConfig: localStorage.getItem('apiConfig'),
            characters: localStorage.getItem('characters'),
            chats: localStorage.getItem('chats'),
            posts: localStorage.getItem('posts'),
            customStickers: localStorage.getItem('customStickers'),
            momentsBackground: localStorage.getItem('momentsBackground'),
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target?.result as string);
                Object.keys(data).forEach(key => {
                    if (data[key] !== null && data[key] !== undefined) {
                        localStorage.setItem(key, data[key]);
                    }
                });
                alert("Data imported successfully! The application will now reload.");
                window.location.reload();
            } catch (error) {
                alert("Failed to import data. The file might be corrupted.");
                console.error("Import error:", error);
            }
        };
        reader.readAsText(file);
    };

    const activeCharacter = characters.find(c => c.id === activeChatCharacterId);
    const characterToEdit = characters.find(c => c.id === characterToEditId);
    const allPersonas = { [USER_ID]: { name: userName, avatarUrl: userAvatar }, ...Object.fromEntries(characters.map(c => [c.id, c])) };

    const activeCharacterForBg = characters.find(c => c.id === activeChatCharacterId);
    const activeChatBg = activeCharacterForBg?.chatBackgroundUrl;

    const renderContent = () => {
        if (characterToEdit) {
            return <CharacterDetailsView character={characterToEdit} onSave={handleEditCharacter} onBack={() => setCharacterToEditId(null)} />;
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
                />
            );
        }
        switch (currentView) {
            case 'chats': return <ChatListView characters={characters} chats={chats} onSelectChat={setActiveChatCharacterId} onAdd={() => setCurrentView('add-menu')} />;
            case 'contacts': return <ContactsView characters={characters} onSelectChat={setActiveChatCharacterId} />;
            case 'moments': return <MomentsView personas={allPersonas} posts={posts} onAddComment={handleAddComment} onAddPost={() => setShowAddPostModal(true)} onGenerate={() => setShowSelectAuthorModal(true)} userName={userName} userAvatar={userAvatar} momentsBackground={momentsBackground} />;
            case 'me': return <SettingsView currentConfig={apiConfig} onSaveApiConfig={handleSaveApiConfig} apiKeys={apiKeys} activeApiKeyId={activeApiKeyId} onDeleteApiKey={handleDeleteApiKey} onSetActiveApiKey={handleSetActiveApiKey} userName={userName} userAvatar={userAvatar} onSaveUserName={handleSaveUserName} onSaveUserAvatar={handleSaveUserAvatar} onImport={handleImportData} onExport={handleExportData} onSetMomentsBackground={setMomentsBackground} onAddApiKey={() => setShowAddApiKeyModal(true)} currentTheme={theme} onThemeChange={setTheme} />;
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
        ${momentsBackground ? `
          .moments-page .moments-cover-photo {
            background-image: url("${momentsBackground}");
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
        const lastMsg = [...chat].reverse().find(m => m.content);
        if (!lastMsg) return "No messages yet.";
        if (lastMsg.content.includes('[sticker:')) return '[Sticker]';
        if (lastMsg.content.includes('[voice:')) return '[Voice Message]';
        if (lastMsg.content.includes('[transfer:')) return '[Transfer]';
        return lastMsg.content.length > 30 ? `${lastMsg.content.substring(0, 30)}...` : lastMsg.content;
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
    const { content, role } = message;
    if (!content) return null;

    const stickerMap = new Map(stickers.map(s => [s.name, s.imageUrl]));
    const parts = content.split(/(\[sticker:.*?\]|\[voice:.*?\]|\[transfer:.*?\])/g).filter(Boolean);

    return (
        <>
            {parts.map((part, index) => {
                const stickerMatch = part.match(/\[sticker:(.*?)\]/);
                if (stickerMatch) {
                    const stickerName = stickerMatch[1];
                    const imageUrl = stickerMap.get(stickerName);
                    return imageUrl ? <img key={index} src={imageUrl} alt={stickerName} className="sticker-in-chat" /> : part;
                }

                const voiceMatch = part.match(/\[voice:.*?\]/);
                if (voiceMatch) {
                    return <React.Fragment key={index}>[Voice Message]</React.Fragment>
                }

                const transferMatch = part.match(/\[transfer:(.*?):(.*?)\]/);
                if (transferMatch) {
                    const amount = parseFloat(transferMatch[1]).toFixed(2);
                    const notes = transferMatch[2];
                    const isSent = role === 'user';

                    const transferNote = isSent
                        ? (notes || '你发起了一笔转账')
                        : (notes || '转账给你');

                    const bubbleClass = isSent ? 'sent' : 'received';

                    return (
                        <div key={index} className={`transfer-bubble-wechat ${bubbleClass}`}>
                            <div className="transfer-bubble-wechat-main">
                                <div className="transfer-bubble-wechat-icon">
                                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <path d="M10 8L6 12l4 4"></path><path d="M14 16l4-4-4-4"></path>
                                    </svg>
                                </div>
                                <div className="transfer-bubble-wechat-details">
                                    <span className="transfer-amount">¥{amount}</span>
                                    <span className="transfer-note">{transferNote}</span>
                                </div>
                            </div>
                            <div className="transfer-bubble-wechat-footer">
                                <span>微信转账</span>
                            </div>
                        </div>
                    );
                }

                return <React.Fragment key={index}>{part}</React.Fragment>;
            })}
        </>
    );
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

const ActionsPanel: React.FC<{ onTransferClick: () => void; isOpen: boolean; }> = ({ onTransferClick, isOpen }) => {
    return (
        <div className={`actions-panel ${isOpen ? 'open' : ''}`}>
            <div className="actions-grid">
                <div className="action-item" onClick={onTransferClick}>
                    <div className="action-icon-wrapper transfer-icon-bg">
                        <svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12V6.5m0 0l-2.5 2.5M12 6.5l2.5 2.5" /><path d="M12 21.5a9.5 9.5 0 100-19 9.5 9.5 0 000 19z" clipRule="evenodd" /></g></svg>
                    </div>
                    <span className="action-label">Transfer</span>
                </div>
            </div>
        </div>
    );
};

const TransferModal: React.FC<{ onClose: () => void; onSend: (amount: string, notes: string) => void; }> = ({ onClose, onSend }) => {
    const [amount, setAmount] = useState('');
    const [notes, setNotes] = useState('');

    const handleSend = () => {
        const parsedAmount = parseFloat(amount);
        if (!isNaN(parsedAmount) && parsedAmount > 0) {
            onSend(parsedAmount.toFixed(2), notes);
        } else {
            alert("Please enter a valid amount.");
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content transfer-modal-content" onClick={e => e.stopPropagation()}>
                <div className="transfer-modal-header">
                    <button className="close-btn" onClick={onClose}>&times;</button>
                    <span>Transfer</span>
                </div>
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
                <button className="save-btn-full" onClick={handleSend} disabled={!amount}>Transfer</button>
            </div>
        </div>
    );
};


const ChatView: React.FC<{ character: Character; messages: ChatMessage[]; onSendMessage: (characterId: string, message: string) => void; onBack: () => void; onShowDetails: () => void; userAvatar: string; customStickers: CustomSticker[]; onAddSticker: () => void; onDeleteSticker: (id: string) => void; }> = ({ character, messages, onSendMessage, onBack, onShowDetails, userAvatar, customStickers, onAddSticker, onDeleteSticker }) => {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [isSending, setIsSending] = useState(false);
    const [activePanel, setActivePanel] = useState<'stickers' | 'actions' | null>(null);
    const [showTransferModal, setShowTransferModal] = useState(false);

    const lastModelMessage = [...messages].reverse().find(m => m.role === 'model');
    const isErrorState = lastModelMessage?.content.includes("API Key");

    useEffect(() => {
        const timeout = setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 100);
        return () => clearTimeout(timeout);
    }, [messages, messages.length, lastModelMessage?.content]);

    const handleSend = async () => {
        if (input.trim() === '' || isSending) return;
        setIsSending(true);
        const messageToSend = input.trim();
        setInput('');
        await onSendMessage(character.id, messageToSend);
        setIsSending(false);
    };

    const handleSendSticker = (sticker: CustomSticker) => {
        onSendMessage(character.id, `[sticker:${sticker.name}]`);
        setActivePanel(null);
    };

    const handleSendTransfer = (amount: string, notes: string) => {
        onSendMessage(character.id, `[transfer:${amount}:${notes || ''}]`);
        setShowTransferModal(false);
        setActivePanel(null);
    };

    const isSpecialContent = (content: string) => /^(?:\[sticker:.*?\]|\[transfer:.*?\])$/.test(content.trim());

    return (
        <div className="chat-view" data-character-id={character.id}>
            <Header title={character.name} onBack={onBack} onAction={onShowDetails} actionIcon="info" />
            <main className="messages-container">
                {messages.filter(msg => msg.content || msg.role === 'model').map((msg, index) => {
                    const prevMsg = messages[index - 1];
                    const showTimestamp = !prevMsg || (msg.timestamp - prevMsg.timestamp > TIME_GAP_THRESHOLD);

                    return (
                        <React.Fragment key={msg.id || index}>
                            {showTimestamp && <div className="timestamp-wrapper"><span className="timestamp">{formatTimestamp(msg.timestamp)}</span></div>}
                            <div className={`message-bubble ${msg.role} ${isSpecialContent(msg.content) ? 'special-content-bubble' : ''}`}>
                                <img src={msg.role === 'model' ? character.avatarUrl : userAvatar} alt={msg.role} className="avatar" />
                                <div className="message-content">
                                    <ChatMessageContent message={msg} stickers={customStickers} />
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
                <ActionsPanel onTransferClick={() => { setActivePanel(null); setShowTransferModal(true); }} isOpen={activePanel === 'actions'} />
            </footer>
            {showTransferModal && <TransferModal onClose={() => setShowTransferModal(false)} onSend={handleSendTransfer} />}
        </div>
    );
};

const MomentsView: React.FC<{ personas: Record<string, { name: string, avatarUrl: string }>; posts: MomentPost[]; onGenerate: () => void; onAddComment: (postId: string, text: string) => void; onAddPost: () => void; userName: string; userAvatar: string; momentsBackground: string | null; }> = ({ personas, posts, onGenerate, onAddComment, onAddPost, userName, userAvatar, momentsBackground }) => {
    const [showMenu, setShowMenu] = useState(false);
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

    const handlePost = () => { setShowMenu(false); onAddPost(); };
    const handleGenerate = () => { setShowMenu(false); onGenerate(); };

    return (
        <div className="moments-page">
            <main className="main-content moments-view">
                <Header title="Moments" onAction={() => setShowMenu(s => !s)} actionIcon="camera" className="moments-header-overlay" />
                {showMenu &&
                    <div className="moments-action-menu" ref={menuRef}>
                        <div onClick={handlePost}>Create Post</div>
                        <div onClick={handleGenerate}>Generate AI Moment</div>
                    </div>
                }
                <div className="moments-feed-header">
                    <div className="moments-cover-photo"></div>
                    <div className="moments-user-info">
                        <span>{userName}</span>
                        <img src={userAvatar} alt="user avatar" className="avatar" />
                    </div>
                </div>
                <div className="moments-posts-list">
                    {posts.map(post => {
                        const author = personas[post.authorId];
                        if (!author) return null;
                        return <MomentPostItem key={post.id} post={post} author={author} personas={personas} onAddComment={onAddComment} />;
                    })}
                </div>
            </main>
        </div>
    );
};

const MomentPostItem: React.FC<{ post: MomentPost; author: { name: string; avatarUrl: string }; personas: Record<string, { name: string, avatarUrl: string }>; onAddComment: (postId: string, text: string) => void }> = ({ post, author, personas, onAddComment }) => {
    const [commentInput, setCommentInput] = useState('');
    const handleCommentSubmit = () => {
        if (commentInput.trim()) {
            onAddComment(post.id, commentInput.trim());
            setCommentInput('');
        }
    }
    return (
        <div className="moment-post">
            <div className="moment-header"><img src={author.avatarUrl} alt={author.name} className="avatar" /><h4>{author.name}</h4></div>
            <p className="moment-content">{post.content}</p>
            <div className="moment-footer">{post.timestamp}</div>
            {(post.comments.length > 0 || post.authorId !== USER_ID) &&
                <div className="comments-section">
                    {post.comments.map(comment => {
                        const commenter = personas[comment.authorId];
                        return (
                            <div key={comment.id} className="comment-item">
                                <div className="comment-content">
                                    <span className="comment-author">{commenter.name}: </span>
                                    <span>{comment.content}</span>
                                </div>
                            </div>
                        )
                    })}
                    <div className="comment-input-area">
                        <input type="text" placeholder="Add a comment..." value={commentInput} onChange={e => setCommentInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleCommentSubmit()} />
                        <button onClick={handleCommentSubmit}>Send</button>
                    </div>
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

const CharacterDetailsView: React.FC<{ character: Character, onBack: () => void; onSave: (id: string, name: string, avatarUrl: string, instruction: string, chatBackgroundUrl?: string) => void; }> = ({ character, onBack, onSave }) => {
    const [name, setName] = useState(character.name);
    const [avatarUrl, setAvatarUrl] = useState(character.avatarUrl);
    const [instruction, setInstruction] = useState(character.systemInstruction);
    const [backgroundUrl, setBackgroundUrl] = useState(character.chatBackgroundUrl);
    const bgInputRef = useRef<HTMLInputElement>(null);

    const handleSave = () => {
        if (name.trim() && instruction.trim()) {
            onSave(character.id, name.trim(), avatarUrl.trim(), instruction.trim(), backgroundUrl);
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