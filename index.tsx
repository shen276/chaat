
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import './src/index.css';

// --- TYPE DEFINITIONS ---
interface ApiKey {
    id: string;
    name: string;
    key: string;
}
interface Character {
    id: string;
    name: string;
    avatarUrl: string;
    systemInstruction: string;
    chatBackgroundUrl?: string;
}
interface Message {
    id: string;
    role: 'user' | 'model';
    content: string;
    timestamp: number;
}
interface ChatHistory {
    [characterId: string]: Message[];
}
interface Comment {
    id: string;
    authorId: string;
    content: string;
}
interface Post {
    id: string;
    authorId: string;
    content: string;
    timestamp: string;
    comments: Comment[];
}
interface Sticker {
    id: string;
    name: string;
    imageUrl: string;
}
interface ApiConfig {
    model: string;
    temperature: number;
}
interface Persona {
    name: string;
    avatarUrl: string;
}
interface AllPersonas {
    [id: string]: Persona;
}

// FIX: Define HeaderProps with optional properties to fix missing prop errors.
interface HeaderProps {
    title: string | React.ReactElement;
    leftButton?: React.ReactElement;
    rightButton?: React.ReactElement;
    className?: string;
}

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
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Failed to read file as a string.'));
            }
        };
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
};

const formatTimestamp = (ts: number) => {
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


const App = (): React.ReactElement => {
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [activeApiKeyId, setActiveApiKeyId] = useState<string | null>(null);
    const [userName, setUserName] = useState('User');
    const [userAvatar, setUserAvatar] = useState('https://api.dicebear.com/8.x/initials/svg?seed=User');
    const [currentView, setCurrentView] = useState('chats');
    const [characters, setCharacters] = useState<Character[]>([]);
    const [chats, setChats] = useState<ChatHistory>({});
    const [posts, setPosts] = useState<Post[]>([]);
    const [customStickers, setCustomStickers] = useState<Sticker[]>([]);
    const [activeChatCharacterId, setActiveChatCharacterId] = useState<string | null>(null);
    const [characterToEditId, setCharacterToEditId] = useState<string | null>(null);
    const [showAddCharacterModal, setShowAddCharacterModal] = useState(false);
    const [showAddPostModal, setShowAddPostModal] = useState(false);
    const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
    const [showSelectAuthorModal, setShowSelectAuthorModal] = useState(false);
    const [showAddStickerModal, setShowAddStickerModal] = useState(false);
    const [showTransferModal, setShowTransferModal] = useState(false);
    const [apiConfig, setApiConfig] = useState<ApiConfig>({ model: 'gemini-2.5-flash', temperature: 0.7 });
    const [momentsBackground, setMomentsBackground] = useState<string | null>(null);
    const [theme, setTheme] = useState('wechat');

    const chatInstances = useRef({});

    useEffect(() => {
        // Load everything from localStorage
        const savedTheme = localStorage.getItem('chatTheme') || 'wechat';
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
        const initialChats: ChatHistory = {};
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
        if (userAvatar.includes('api.dicebear.com/8.x/initials')) {
            setUserAvatar(`https://api.dicebear.com/8.x/initials/svg?seed=${name}`);
        }
    };

    const handleSaveUserAvatar = (avatar: string) => {
        setUserAvatar(avatar);
    };

    const getChat = (character: Character) => {
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

        const userMessages: Message[] = messageParts.map(content => ({
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
                    if (lastMessage.role !== 'model') { // Safety check
                        chatHistory.push({ id: `msg_${Date.now()}_pending`, role: 'model', content: '', timestamp: Date.now() });
                        lastMessage = chatHistory[chatHistory.length - 1];
                    }

                    while (messageBuffer.includes(MULTI_MESSAGE_SEPARATOR)) {
                        const parts = messageBuffer.split(MULTI_MESSAGE_SEPARATOR);
                        lastMessage.content = (lastMessage.content || "") + parts.shift();
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
                const chatHistory = newChats[characterId]
                if (chatHistory && chatHistory.length > 0) {
                    const lastMessage = chatHistory[chatHistory.length - 1];
                    if (lastMessage?.role === 'model') {
                        lastMessage.content = errorMessage;
                    }
                }
                return newChats;
            });
        }
    };

    const generateAiContent = async (prompt: string) => {
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

    const generateCommentsForPost = async (post: Post) => {
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
                const newComment = { id: `comment_${Date.now()}`, authorId: commenter.id, content: commentContent };
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
            const newPost: Post = {
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
        const newPost: Post = {
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

    const handleEditCharacter = (id: string, name: string, avatarUrl: string, instruction: string, chatBackgroundUrl: string) => {
        setCharacters(prev => prev.map(c => c.id === id ? { ...c, name, avatarUrl, systemInstruction: instruction, chatBackgroundUrl } : c));
        setCharacterToEditId(null);
        chatInstances.current = {};
    }

    const handleSaveApiConfig = (newConfig: ApiConfig) => {
        setApiConfig(newConfig);
        chatInstances.current = {};
    };

    const handleAddSticker = (name: string, imageUrl: string) => {
        const newSticker: Sticker = { id: `sticker_${Date.now()}`, name, imageUrl };
        setCustomStickers(prev => [...prev, newSticker]);
        setShowAddStickerModal(false);
    };

    const handleDeleteSticker = (id: string) => {
        setCustomStickers(prev => prev.filter(s => s.id !== id));
    };
    
    const handleSendTransfer = (amount: string, notes: string) => {
        if (!activeChatCharacterId) return;
        const messageContent = `[transfer:${amount}:${notes}]`;
        handleSendMessage(activeChatCharacterId, messageContent);
        setShowTransferModal(false);
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
                const result = event.target?.result;
                if (typeof result === 'string') {
                    const data = JSON.parse(result);
                    Object.keys(data).forEach(key => {
                        if (data[key] !== null && data[key] !== undefined) {
                            localStorage.setItem(key, data[key]);
                        }
                    });
                    alert("Data imported successfully! The application will now reload.");
                    window.location.reload();
                } else {
                    throw new Error("Failed to read file content.");
                }
            } catch (error) {
                alert("Failed to import data. The file might be corrupted.");
                console.error("Import error:", error);
            }
        };
        reader.readAsText(file);
    };

    const activeCharacter = characters.find(c => c.id === activeChatCharacterId);
    const characterToEdit = characters.find(c => c.id === characterToEditId);
    const allPersonas: AllPersonas = { [USER_ID]: { name: userName, avatarUrl: userAvatar }, ...Object.fromEntries(characters.map(c => [c.id, c])) };

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
                    onShowTransfer={() => setShowTransferModal(true)}
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
            {showSelectAuthorModal && <SelectAuthorModal characters={characters} onClose={() => setShowSelectAuthorModal(false)} onSelect={handleGenerateMoment} />}
            {showAddStickerModal && <AddStickerModal onClose={() => setShowAddStickerModal(false)} onSave={handleAddSticker} />}
            {showTransferModal && <TransferModal onClose={() => setShowTransferModal(false)} onSend={handleSendTransfer} />}
        </div>
    );
};

// --- UI COMPONENTS ---

const Header = ({ title, leftButton, rightButton, className }: HeaderProps) => (
    <header className={`header ${className || ''}`}>
        {leftButton && <div className="header-button back-button">{leftButton}</div>}
        <h1>{title}</h1>
        {rightButton && <div className="header-button action-button">{rightButton}</div>}
    </header>
);

const BottomNav = ({ activeView, onViewChange }) => (
    <nav className="bottom-nav">
        <button className={`nav-item ${activeView === 'chats' ? 'active' : ''}`} onClick={() => onViewChange('chats')}>
            <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" /></svg>
            <span>Chats</span>
        </button>
        <button className={`nav-item ${activeView === 'contacts' ? 'active' : ''}`} onClick={() => onViewChange('contacts')}>
            <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
            <span>Contacts</span>
        </button>
        <button className={`nav-item ${activeView === 'moments' ? 'active' : ''}`} onClick={() => onViewChange('moments')}>
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" /></svg>
            <span>Moments</span>
        </button>
        <button className={`nav-item ${activeView === 'me' ? 'active' : ''}`} onClick={() => onViewChange('me')}>
            <svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
            <span>Me</span>
        </button>
    </nav>
);

const ChatListView = ({ characters, chats, onSelectChat, onAdd }) => (
    <div className="main-content">
        <Header title="Chats" rightButton={
            <button onClick={onAdd} style={{background:'none', border:'none', color:'white'}}>
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
            </button>
        }/>
        <ul className="chat-list">
            {characters.map(character => {
                const lastMessage = chats[character.id]?.[chats[character.id].length - 1];
                return (
                    <li key={character.id} className="chat-list-item" onClick={() => onSelectChat(character.id)}>
                        <img src={character.avatarUrl} alt={character.name} className="avatar" />
                        <div className="chat-info">
                            <h3>{character.name}</h3>
                            <p>{lastMessage?.content?.startsWith('[sticker:') ? '[Sticker]' : lastMessage?.content?.startsWith('[transfer:') ? '[Transfer]' : lastMessage?.content || 'No messages yet'}</p>
                        </div>
                    </li>
                );
            })}
        </ul>
    </div>
);

const ChatView = ({ character, messages, onSendMessage, onBack, onShowDetails, userAvatar, customStickers, onAddSticker, onDeleteSticker, onShowTransfer }) => {
    const [inputValue, setInputValue] = useState('');
    const [isStickerPanelOpen, setIsStickerPanelOpen] = useState(false);
    const [isActionsPanelOpen, setIsActionsPanelOpen] = useState(false);
    const [isEditingStickers, setIsEditingStickers] = useState(false);
    const messagesEndRef = useRef<null | HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    const handleSend = () => {
        if (inputValue.trim()) {
            onSendMessage(character.id, inputValue.trim());
            setInputValue('');
        }
    };

    const handleStickerSend = (stickerName: string) => {
        onSendMessage(character.id, `[sticker:${stickerName}]`);
        setIsStickerPanelOpen(false);
    };

    const handlePanelToggle = (panel: 'sticker' | 'actions') => {
        if (panel === 'sticker') {
            setIsStickerPanelOpen(!isStickerPanelOpen);
            setIsActionsPanelOpen(false);
        } else {
            setIsActionsPanelOpen(!isActionsPanelOpen);
            setIsStickerPanelOpen(false);
        }
    }

    const renderMessageContent = (msg: Message) => {
        if (msg.content.startsWith('[sticker:')) {
            const stickerName = msg.content.match(/\[sticker:(.+?)]/)?.[1];
            const sticker = customStickers.find(s => s.name === stickerName);
            return sticker ? <img src={sticker.imageUrl} alt={sticker.name} className="sticker-in-chat" /> : `[sticker: ${stickerName}]`;
        }
        if (msg.content.startsWith('[transfer:')) {
            const parts = msg.content.match(/\[transfer:(.*?):(.*?)\]/);
            if (!parts) return msg.content;
            const [, amount, notes] = parts;
            return <TransferBubble amount={amount} notes={notes} isSent={msg.role === 'user'} />;
        }
        return msg.content;
    };
    
    return (
        <div className="chat-view" data-character-id={character.id}>
            <Header
                title={character.name}
                leftButton={<button onClick={onBack} aria-label="Back">‹</button>}
                rightButton={<button onClick={onShowDetails} aria-label="Details"><svg viewBox="0 0 24 24"><path d="M12 5.9c1.16 0 2.1.94 2.1 2.1s-.94 2.1-2.1 2.1S9.9 9.16 9.9 8s.94-2.1 2.1-2.1m0 9c-1.16 0-2.1-.94-2.1-2.1s.94-2.1 2.1-2.1 2.1.94 2.1 2.1-.94 2.1-2.1 2.1m0 9c-1.16 0-2.1-.94-2.1-2.1s.94-2.1 2.1-2.1 2.1.94 2.1 2.1-.94 2.1-2.1 2.1z"/></svg></button>}
            />
            <div className="messages-container">
                {messages.map((msg, index) => {
                    const prevMsg = messages[index-1];
                    const showTimestamp = !prevMsg || (msg.timestamp - prevMsg.timestamp > TIME_GAP_THRESHOLD);
                    const isSpecial = msg.content.startsWith('[sticker:') || msg.content.startsWith('[transfer:');
                    
                    return (
                        <React.Fragment key={msg.id}>
                            {showTimestamp && <div className="timestamp-wrapper"><span className="timestamp">{formatTimestamp(msg.timestamp)}</span></div>}
                            <div className={`message-bubble ${msg.role} ${isSpecial ? 'special-content-bubble' : ''}`}>
                                <img src={msg.role === 'user' ? userAvatar : character.avatarUrl} alt="avatar" className="avatar" />
                                <div className="message-content">
                                    {renderMessageContent(msg)}
                                </div>
                            </div>
                        </React.Fragment>
                    )
                })}
                <div ref={messagesEndRef} />
            </div>
            <div className="chat-input-area">
                <div className="chat-input-controls">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Type a message..."
                    />
                    <button className="sticker-toggle-btn" onClick={() => handlePanelToggle('sticker')}>
                        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM8 11.5c.83 0 1.5-.67 1.5-1.5S8.83 8.5 8 8.5s-1.5.67-1.5 1.5.67 1.5 1.5 1.5zm8 0c.83 0 1.5-.67 1.5-1.5s-.83-1.5-1.5-1.5-1.5.67-1.5 1.5.67 1.5 1.5 1.5zm-4 3c-1.68 0-3.18.8-4.22 2.04.42.61.94 1.12 1.55 1.52.89.58 1.96.94 3.12.94s2.23-.36 3.12-.94c.61-.4 1.13-.91 1.55-1.52C15.18 15.3 13.68 14.5 12 14.5z" /></svg>
                    </button>
                    {inputValue ? (
                         <button className="send-btn" onClick={handleSend}>Send</button>
                    ) : (
                        <button className="actions-toggle-btn" onClick={() => handlePanelToggle('actions')}>
                             <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7v-2h4V7h2v4h4v2h-4v4h-2z" /></svg>
                        </button>
                    )}
                </div>
                <div className={`sticker-panel ${isStickerPanelOpen ? 'open' : ''}`}>
                    <div className="sticker-panel-header">
                        <button className="sticker-panel-action-btn" onClick={() => setIsEditingStickers(!isEditingStickers)}>
                            {isEditingStickers ? 'Done' : 'Edit'}
                        </button>
                    </div>
                    <div className="sticker-grid-chat">
                        {customStickers.map(sticker => (
                            <div key={sticker.id} className="sticker-item-chat" onClick={() => !isEditingStickers && handleStickerSend(sticker.name)}>
                                <img src={sticker.imageUrl} alt={sticker.name} />
                                {isEditingStickers && (
                                    <button className="delete-sticker-btn" onClick={() => onDeleteSticker(sticker.id)}>×</button>
                                )}
                            </div>
                        ))}
                        <div className="add-sticker-btn-chat" onClick={onAddSticker}>+</div>
                    </div>
                </div>
                 <div className={`actions-panel ${isActionsPanelOpen ? 'open' : ''}`}>
                    <div className="actions-grid">
                         <div className="action-item" onClick={() => { onShowTransfer(); setIsActionsPanelOpen(false); }}>
                            <div className="action-icon-wrapper transfer-icon-bg">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-9 3-3 3 3m-3 12a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z" /></svg>
                            </div>
                            <span className="action-label">Transfer</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const TransferBubble = ({ amount, notes, isSent }) => (
    <div className={`transfer-bubble-wechat ${isSent ? 'sent' : 'received'}`}>
        <div className="transfer-bubble-wechat-main">
            <div className="transfer-bubble-wechat-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 6v12m-3-9 3-3 3 3m-3 12a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z" /></svg>
            </div>
            <div className="transfer-bubble-wechat-details">
                <span className="transfer-amount">¥{parseFloat(amount).toFixed(2)}</span>
                {notes && <span className="transfer-note">{notes}</span>}
            </div>
        </div>
        <div className="transfer-bubble-wechat-footer">Gemini Transfer</div>
    </div>
);


const ContactsView = ({ characters, onSelectChat }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const filteredCharacters = characters.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {isSearching ? (
                 <div className="search-header-active">
                     <div className="search-input-wrapper-active">
                         <input
                             type="text"
                             className="search-input-active"
                             placeholder="Search"
                             value={searchTerm}
                             onChange={(e) => setSearchTerm(e.target.value)}
                             autoFocus
                         />
                     </div>
                     <button className="cancel-search-btn" onClick={() => { setIsSearching(false); setSearchTerm(''); }}>Cancel</button>
                 </div>
            ) : (
                <Header title="Contacts" rightButton={
                    <button onClick={() => setIsSearching(true)} style={{ background: 'none', border: 'none' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
                    </button>
                } />
            )}
            <div className="main-content contact-list-main">
                <ul className="chat-list">
                    {filteredCharacters.map(character => (
                        <li key={character.id} className="chat-list-item" onClick={() => onSelectChat(character.id)}>
                            <img src={character.avatarUrl} alt={character.name} className="avatar" />
                            <div className="chat-info">
                                <h3>{character.name}</h3>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

// ... Other components would go here in a real app
const GenericModal = ({ children, onClose }) => (
    <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
            {children}
        </div>
    </div>
);

const AddCharacterModal = ({ onClose, onSave }) => {
    const [name, setName] = useState('');
    const [avatar, setAvatar] = useState('');
    const [instruction, setInstruction] = useState('');
    return (
        <GenericModal onClose={onClose}>
            <h2>Add New Character</h2>
            <div className="form-group">
                <label>Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Character Name" />
            </div>
            <div className="form-group">
                <label>Avatar URL (Optional)</label>
                <input type="text" value={avatar} onChange={e => setAvatar(e.target.value)} placeholder="https://..." />
            </div>
            <div className="form-group">
                <label>System Instruction</label>
                <textarea value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Describe the character's persona..."></textarea>
            </div>
            <div className="modal-actions">
                <button className="cancel-btn" onClick={onClose}>Cancel</button>
                <button className="save-btn" onClick={() => onSave(name, avatar, instruction)} disabled={!name || !instruction}>Save</button>
            </div>
        </GenericModal>
    );
};

const AddApiKeyModal = ({ onClose, onSave }) => {
    const [name, setName] = useState('');
    const [key, setKey] = useState('');
    return (
        <GenericModal onClose={onClose}>
            <h2>Add Gemini API Key</h2>
            <div className="form-group">
                <label>Key Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., My Personal Key" />
            </div>
            <div className="form-group">
                <label>API Key</label>
                <input type="text" value={key} onChange={e => setKey(e.target.value)} placeholder="Paste your key here" />
            </div>
            <div className="billing-link">
              <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer">
                API key billing information
              </a>
            </div>
            <div className="modal-actions">
                <button className="cancel-btn" onClick={onClose}>Cancel</button>
                <button className="save-btn" onClick={() => onSave(name, key)} disabled={!name || !key}>Save</button>
            </div>
        </GenericModal>
    );
};

const AddMenuView = ({ onBack, onAddCharacter, onAddApiKey }) => {
    return (
        <div className="main-content settings-view">
            <Header title="Add" leftButton={<button onClick={onBack}>‹</button>} />
             <div className="settings-section">
                <div className="settings-item" onClick={onAddCharacter}>
                    <span>Add New Character</span>
                    <span className="arrow">›</span>
                </div>
                 <div className="settings-item" onClick={onAddApiKey}>
                    <span>Add New API Key</span>
                    <span className="arrow">›</span>
                </div>
            </div>
        </div>
    );
};

const SettingsView = ({ currentConfig, onSaveApiConfig, apiKeys, activeApiKeyId, onDeleteApiKey, onSetActiveApiKey, userName, userAvatar, onSaveUserName, onSaveUserAvatar, onImport, onExport, onSetMomentsBackground, onAddApiKey, currentTheme, onThemeChange }) => {
    const [editingName, setEditingName] = useState(false);
    const [tempName, setTempName] = useState(userName);
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const momentsBgInputRef = useRef<HTMLInputElement>(null);
    const importFileRef = useRef<HTMLInputElement>(null);

    const handleAvatarClick = () => avatarInputRef.current?.click();
    const handleMomentsBgClick = () => momentsBgInputRef.current?.click();
    const handleImportClick = () => importFileRef.current?.click();
    
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, callback) => {
        const file = e.target.files?.[0];
        if (file) {
            const base64 = await imageFileToBase64(file);
            callback(base64);
        }
    };

    const handleNameSave = () => {
        onSaveUserName(tempName);
        setEditingName(false);
    };

    return (
        <div className="main-content settings-view">
            <Header title="Me" />
            <div className="user-profile-banner">
                <div className="avatar-uploader" onClick={handleAvatarClick}>
                    <img src={userAvatar} alt="User Avatar" className="profile-banner-avatar"/>
                    <div className="avatar-overlay">Change</div>
                    <input type="file" accept="image/*" style={{ display: 'none' }} ref={avatarInputRef} onChange={(e) => handleFileChange(e, onSaveUserAvatar)} />
                </div>
                {editingName ? (
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <input type="text" value={tempName} onChange={e => setTempName(e.target.value)} />
                        <button onClick={handleNameSave}>Save</button>
                    </div>
                ) : (
                    <div className="user-name-display" onClick={() => { setTempName(userName); setEditingName(true); }}>
                        <span>{userName}</span>
                        <svg className="edit-icon" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                    </div>
                )}
            </div>
            
            <div className="settings-section">
                <h3>API Keys</h3>
                <ul className="api-key-list">
                    {apiKeys.map(key => (
                        <li key={key.id} className="api-key-item">
                            <input type="radio" name="api-key" checked={activeApiKeyId === key.id} onChange={() => onSetActiveApiKey(key.id)} />
                            <div className="api-key-info" onClick={() => onSetActiveApiKey(key.id)}>
                                <span className="name">{key.name}</span>
                                <span className="key-preview">{key.key.substring(0, 4)}...{key.key.slice(-4)}</span>
                            </div>
                            <button className="delete-key-btn" onClick={() => onDeleteApiKey(key.id)}>Delete</button>
                        </li>
                    ))}
                </ul>
                 <div className="add-key-button" onClick={onAddApiKey}>+ Add a new key</div>
            </div>

            <div className="settings-section">
                <h3>Model Settings</h3>
                <div className="settings-item">
                    <label>Model</label>
                    <select value={currentConfig.model} onChange={e => onSaveApiConfig({ ...currentConfig, model: e.target.value })}>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    </select>
                </div>
                 <div className="settings-item">
                     <label>Temperature</label>
                     <div className="slider-container">
                         <span>0.0</span>
                         <input type="range" min="0" max="1" step="0.1" value={currentConfig.temperature} onChange={e => onSaveApiConfig({ ...currentConfig, temperature: parseFloat(e.target.value) })}/>
                         <span>1.0</span>
                     </div>
                 </div>
            </div>
            
             <div className="settings-section">
                <h3>Appearance</h3>
                <div className="settings-item">
                    <label>Theme</label>
                    <select value={currentTheme} onChange={e => onThemeChange(e.target.value)}>
                        <option value="wechat">WeChat</option>
                        <option value="sakura-pink">Sakura Pink</option>
                        <option value="ocean-blue">Ocean Blue</option>
                        <option value="mint-green">Mint Green</option>
                        <option value="lavender-dream">Lavender Dream</option>
                    </select>
                </div>
                <div className="settings-item" onClick={handleMomentsBgClick}>
                    <span>Moments Cover Photo</span>
                     <span className="arrow">›</span>
                    <input type="file" accept="image/*" style={{ display: 'none' }} ref={momentsBgInputRef} onChange={(e) => handleFileChange(e, onSetMomentsBackground)} />
                </div>
            </div>

            <div className="settings-section">
                 <h3>Data Management</h3>
                <div className="settings-item" onClick={onExport}>
                    <span>Export Data</span>
                    <span className="arrow">›</span>
                </div>
                <div className="settings-item" onClick={handleImportClick}>
                    <span>Import Data</span>
                    <span className="arrow">›</span>
                    <input type="file" accept=".json" style={{ display: 'none' }} ref={importFileRef} onChange={onImport} />
                </div>
            </div>
        </div>
    );
};

const MomentsView = ({ personas, posts, onAddComment, onAddPost, onGenerate, userName, userAvatar, momentsBackground }) => {
    const [commentInputs, setCommentInputs] = useState({});
    const [showMenu, setShowMenu] = useState(false);

    const handleCommentChange = (postId, text) => {
        setCommentInputs(prev => ({ ...prev, [postId]: text }));
    };

    const handleCommentSubmit = (postId) => {
        if (commentInputs[postId]?.trim()) {
            onAddComment(postId, commentInputs[postId].trim());
            handleCommentChange(postId, '');
        }
    };

    return (
        <div className="main-content moments-view moments-page">
            <Header
                title=""
                className="moments-header-overlay"
                rightButton={
                    <button onClick={() => setShowMenu(!showMenu)} style={{background: 'none', border:'none'}}>
                         <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>
                    </button>
                }
            />
            {showMenu && (
                <div className="moments-action-menu">
                    <div onClick={() => { onAddPost(); setShowMenu(false); }}>New Post</div>
                    <div onClick={() => { onGenerate(); setShowMenu(false); }}>Generate Post</div>
                </div>
            )}
            <div className="moments-feed-header">
                <div className="moments-cover-photo"></div>
                <div className="moments-user-info">
                    <span>{userName}</span>
                    <img src={userAvatar} alt="User Avatar" className="avatar" />
                </div>
            </div>
            <div className="moments-posts-list">
                 {posts.map(post => {
                    const author = personas[post.authorId];
                    return (
                        <div key={post.id} className="moment-post">
                            <div className="moment-header">
                                <img src={author?.avatarUrl} alt={author?.name} className="avatar" />
                                <h4>{author?.name}</h4>
                            </div>
                            <p className="moment-content">{post.content}</p>
                            <div className="moment-footer">{post.timestamp}</div>
                            {(post.comments.length > 0 || true) && (
                                <div className="comments-section">
                                    {post.comments.map(comment => {
                                        const commenter = personas[comment.authorId];
                                        return (
                                            <div key={comment.id} className="comment-item">
                                                <span className="comment-author">{commenter?.name}: </span>
                                                <p className="comment-content">{comment.content}</p>
                                            </div>
                                        );
                                    })}
                                    <div className="comment-input-area">
                                        <input
                                            type="text"
                                            placeholder="Add a comment..."
                                            value={commentInputs[post.id] || ''}
                                            onChange={e => handleCommentChange(post.id, e.target.value)}
                                            onKeyPress={e => e.key === 'Enter' && handleCommentSubmit(post.id)}
                                        />
                                        <button onClick={() => handleCommentSubmit(post.id)}>Send</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

const AddPostModal = ({ onClose, onSave }) => {
    const [content, setContent] = useState('');
    return (
        <GenericModal onClose={onClose}>
            <h2>New Post</h2>
            <div className="form-group">
                <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="What's on your mind?"></textarea>
            </div>
            <div className="modal-actions">
                <button className="cancel-btn" onClick={onClose}>Cancel</button>
                <button className="save-btn" onClick={() => onSave(content)} disabled={!content.trim()}>Post</button>
            </div>
        </GenericModal>
    );
};

const CharacterDetailsView = ({ character, onSave, onBack }) => {
    const [name, setName] = useState(character.name);
    const [avatarUrl, setAvatarUrl] = useState(character.avatarUrl);
    const [instruction, setInstruction] = useState(character.systemInstruction);
    const [backgroundUrl, setBackgroundUrl] = useState(character.chatBackgroundUrl || '');
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const bgInputRef = useRef<HTMLInputElement>(null);

    const handleSave = () => {
        onSave(character.id, name, avatarUrl, instruction, backgroundUrl);
    };
    
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, callback) => {
        const file = e.target.files?.[0];
        if (file) {
            const base64 = await imageFileToBase64(file);
            callback(base64);
        }
    };
    
    return (
        <div className="details-view">
            <Header title="Character Details" leftButton={<button onClick={onBack}>‹</button>} />
            <div className="main-content">
                <div className="details-form">
                    <div className="avatar-uploader modal-avatar-uploader" onClick={() => avatarInputRef.current?.click()}>
                        <img src={avatarUrl} alt="Character Avatar" />
                        <div className="avatar-overlay">Change</div>
                        <input type="file" accept="image/*" style={{ display: 'none' }} ref={avatarInputRef} onChange={(e) => handleFileChange(e, setAvatarUrl)} />
                    </div>
                    <div className="form-group">
                        <label>Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} />
                    </div>
                    <div className="form-group">
                        <label>Avatar URL</label>
                        <input type="text" value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} />
                    </div>
                     <div className="form-group">
                        <label>System Instruction</label>
                        <textarea value={instruction} onChange={e => setInstruction(e.target.value)}></textarea>
                    </div>
                    
                    <div className="details-settings-section">
                        <div className="settings-item" onClick={() => bgInputRef.current?.click()}>
                           <div className="background-preview-wrapper">
                                <img src={backgroundUrl} alt="" className="background-preview" />
                                <span>Chat Background</span>
                           </div>
                           <span className="arrow">›</span>
                           <input type="file" accept="image/*" style={{ display: 'none' }} ref={bgInputRef} onChange={(e) => handleFileChange(e, setBackgroundUrl)} />
                        </div>
                    </div>
                    
                    <button className="save-btn-full" onClick={handleSave}>Save Changes</button>
                </div>
            </div>
        </div>
    );
};

const SelectAuthorModal = ({ characters, onClose, onSelect }) => (
    <GenericModal onClose={onClose}>
        <h2>Generate Post As...</h2>
        <ul className="select-author-list">
            {characters.map(char => (
                <li key={char.id} onClick={() => onSelect(char.id)}>
                    <img src={char.avatarUrl} alt={char.name} className="avatar" />
                    <span>{char.name}</span>
                </li>
            ))}
        </ul>
    </GenericModal>
);

const AddStickerModal = ({ onClose, onSave }) => {
    const [name, setName] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const base64 = await imageFileToBase64(file);
            setImageUrl(base64);
        }
    };
    
    return (
        <GenericModal onClose={onClose}>
            <h2>Add Custom Sticker</h2>
            <div className="form-group">
                <label>Sticker Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., happy, lol, confused" />
            </div>
             <div className="form-group">
                <label>Image</label>
                <button onClick={() => fileInputRef.current?.click()}>Upload Image</button>
                <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
                {imageUrl && <img src={imageUrl} alt="preview" style={{ maxWidth: '100px', maxHeight: '100px', marginTop: '10px' }} />}
            </div>
             <div className="modal-actions">
                <button className="cancel-btn" onClick={onClose}>Cancel</button>
                <button className="save-btn" onClick={() => onSave(name, imageUrl)} disabled={!name.trim() || !imageUrl}>Save</button>
            </div>
        </GenericModal>
    )
};

const TransferModal = ({ onClose, onSend }) => {
    const [amount, setAmount] = useState('');
    const [notes, setNotes] = useState('');

    return (
         <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content transfer-modal-content" onClick={e => e.stopPropagation()}>
                <div className="transfer-modal-header">
                    <button className="close-btn" onClick={onClose}>×</button>
                    Transfer to Character
                </div>
                <div className="form-group transfer-amount-group">
                    <label>Amount</label>
                    <div className="amount-input-wrapper">
                        <span>¥</span>
                        <input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} autoFocus/>
                    </div>
                </div>
                <div className="form-group">
                     <input type="text" className="notes-input" placeholder="Add notes" value={notes} onChange={e => setNotes(e.target.value)}/>
                </div>
                <button className="save-btn-full" onClick={() => onSend(amount, notes)} disabled={!amount || parseFloat(amount) <= 0}>
                    Transfer
                </button>
            </div>
        </div>
    )
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
