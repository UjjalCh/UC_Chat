import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import axios from "axios";
import { io } from "socket.io-client";

import {
  Search,
  Send,
  LogOut,
  MessageCircle,
  Users,
  MoreVertical,
  Paperclip,
  Smile,
  ArrowLeft,
  Check,
  CheckCheck,
  X,
  Loader2,
  UserPlus,
} from "lucide-react";

import "./App.css";

/*
|--------------------------------------------------------------------------
| CONFIGURATION
|--------------------------------------------------------------------------
*/

const API_URL =
  import.meta.env.VITE_API_URL ||
  "http://localhost:5000";

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  API_URL;

/*
|--------------------------------------------------------------------------
| AXIOS
|--------------------------------------------------------------------------
*/

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

/*
|--------------------------------------------------------------------------
| APP
|--------------------------------------------------------------------------
*/

function App() {
  /*
  |--------------------------------------------------------------------------
  | AUTH
  |--------------------------------------------------------------------------
  */

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [authMode, setAuthMode] = useState("signin");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [authError, setAuthError] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | CHAT
  |--------------------------------------------------------------------------
  */

  const [users, setUsers] = useState([]);
  const [conversations, setConversations] = useState([]);

  const [
    selectedConversation,
    setSelectedConversation,
  ] = useState(null);

  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");

  const [loadingUsers, setLoadingUsers] = useState(false);

  const [
    loadingConversations,
    setLoadingConversations,
  ] = useState(false);

  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | SEARCH
  |--------------------------------------------------------------------------
  */

  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  /*
  |--------------------------------------------------------------------------
  | UI
  |--------------------------------------------------------------------------
  */

  const [mobileSidebar, setMobileSidebar] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [typingUser, setTypingUser] = useState(null);

  /*
  |--------------------------------------------------------------------------
  | REFS
  |--------------------------------------------------------------------------
  */

  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  /*
  |--------------------------------------------------------------------------
  | CHECK AUTH
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await api.get("/api/auth/me");

      if (
        response.data?.ok &&
        response.data?.user
      ) {
        setUser(response.data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | LOAD USERS + CONVERSATIONS
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!user) {
      return;
    }

    loadUsers();
    loadConversations();
  }, [user]);

  /*
  |--------------------------------------------------------------------------
  | ONLINE STATUS
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!user) {
      return;
    }

    let heartbeatTimer;

    const setOnline = async () => {
      try {
        await api.post(
          "/api/users/status",
          {
            is_online: true,
          }
        );
      } catch (error) {
        console.error(
          "Online status error:",
          error
        );
      }
    };

    const heartbeat = async () => {
      try {
        await api.post(
          "/api/users/heartbeat"
        );
      } catch (error) {
        console.error(
          "Heartbeat error:",
          error
        );
      }
    };

    const setOffline = () => {
      try {
        const data = JSON.stringify({
          is_online: false,
        });

        const blob = new Blob(
          [data],
          {
            type: "application/json",
          }
        );

        navigator.sendBeacon(
          `${API_URL}/api/users/status`,
          blob
        );
      } catch (error) {
        console.error(
          "Offline status error:",
          error
        );
      }
    };

    setOnline();

    heartbeatTimer = setInterval(
      heartbeat,
      30000
    );

    window.addEventListener(
      "beforeunload",
      setOffline
    );

    window.addEventListener(
      "pagehide",
      setOffline
    );

    return () => {
      clearInterval(heartbeatTimer);

      window.removeEventListener(
        "beforeunload",
        setOffline
      );

      window.removeEventListener(
        "pagehide",
        setOffline
      );
    };
  }, [user]);

  /*
  |--------------------------------------------------------------------------
  | SOCKET.IO
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!user) {
      return;
    }

    const socket = io(
      SOCKET_URL,
      {
        withCredentials: true,

        transports: [
          "websocket",
          "polling",
        ],

        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
      }
    );

    socketRef.current = socket;

    /*
    |--------------------------------------------------------------------------
    | CONNECT
    |--------------------------------------------------------------------------
    */

    socket.on(
      "connect",
      () => {
        console.log(
          "UC Chat Socket connected:",
          socket.id
        );

        if (
          selectedConversation?.id
        ) {
          socket.emit(
            "join_conversation",
            selectedConversation.id
          );
        }
      }
    );

    /*
    |--------------------------------------------------------------------------
    | CONNECT ERROR
    |--------------------------------------------------------------------------
    */

    socket.on(
      "connect_error",
      (error) => {
        console.error(
          "Socket connection error:",
          error.message
        );
      }
    );

    /*
    |--------------------------------------------------------------------------
    | ONLINE / OFFLINE
    |--------------------------------------------------------------------------
    */

    socket.on(
      "user_status_changed",
      (data) => {
        if (!data?.user_id) {
          return;
        }

        const userId = Number(
          data.user_id
        );

        const online = data.is_online
          ? 1
          : 0;

        const updatePerson = (
          person
        ) =>
          Number(person.id) === userId
            ? {
                ...person,
                is_online: online,
                last_seen:
                  data.last_seen,
              }
            : person;

        setUsers(
          (previous) =>
            previous.map(updatePerson)
        );

        setSearchResults(
          (previous) =>
            previous.map(updatePerson)
        );

        setConversations(
          (previous) =>
            previous.map(
              (conversation) =>
                Number(
                  conversation.user_id
                ) === userId
                  ? {
                      ...conversation,
                      is_online: online,
                      last_seen:
                        data.last_seen,
                    }
                  : conversation
            )
        );

        setSelectedConversation(
          (previous) => {
            if (
              !previous ||
              Number(
                previous.user_id
              ) !== userId
            ) {
              return previous;
            }

            return {
              ...previous,
              is_online: online,
              last_seen:
                data.last_seen,
            };
          }
        );
      }
    );

    /*
    |--------------------------------------------------------------------------
    | NEW MESSAGE
    |--------------------------------------------------------------------------
    */

    socket.on(
      "new_message",
      (newMessage) => {
        if (!newMessage?.id) {
          return;
        }

        setMessages(
          (previous) => {
            const exists =
              previous.some(
                (message) =>
                  String(
                    message.id
                  ) ===
                  String(
                    newMessage.id
                  )
              );

            if (exists) {
              return previous;
            }

            return [
              ...previous,
              newMessage,
            ];
          }
        );

        setConversations(
          (previous) =>
            previous.map(
              (conversation) =>
                String(
                  conversation.id
                ) ===
                String(
                  newMessage.conversation_id
                )
                  ? {
                      ...conversation,
                      last_message:
                        newMessage.message,
                      updated_at:
                        newMessage.created_at,
                    }
                  : conversation
            )
        );

        setTimeout(
          scrollToBottom,
          50
        );
      }
    );

    /*
    |--------------------------------------------------------------------------
    | CONVERSATION UPDATED
    |--------------------------------------------------------------------------
    */

    socket.on(
      "conversation_updated",
      (data) => {
        if (
          !data?.conversation_id
        ) {
          return;
        }

        setConversations(
          (previous) =>
            previous.map(
              (conversation) =>
                String(
                  conversation.id
                ) ===
                String(
                  data.conversation_id
                )
                  ? {
                      ...conversation,
                      last_message:
                        data.message
                          ?.message ||
                        conversation.last_message,
                      updated_at:
                        data.message
                          ?.created_at ||
                        conversation.updated_at,
                    }
                  : conversation
            )
        );
      }
    );

    /*
    |--------------------------------------------------------------------------
    | TYPING
    |--------------------------------------------------------------------------
    */

    socket.on(
      "user_typing",
      (data) => {
        if (
          data?.user_id &&
          Number(data.user_id) !==
            Number(user.id)
        ) {
          setTypingUser(data);
        }
      }
    );

    /*
    |--------------------------------------------------------------------------
    | STOP TYPING
    |--------------------------------------------------------------------------
    */

    socket.on(
      "user_stop_typing",
      (data) => {
        if (
          !data?.user_id ||
          Number(data.user_id) ===
            Number(
              typingUser?.user_id
            )
        ) {
          setTypingUser(null);
        }
      }
    );

    /*
    |--------------------------------------------------------------------------
    | DISCONNECT
    |--------------------------------------------------------------------------
    */

    socket.on(
      "disconnect",
      (reason) => {
        console.log(
          "UC Chat Socket disconnected:",
          reason
        );
      }
    );

    return () => {
      socket.removeAllListeners();
      socket.disconnect();

      socketRef.current = null;
    };
  }, [user]);

  /*
  |--------------------------------------------------------------------------
  | LOAD USERS
  |--------------------------------------------------------------------------
  */

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);

      const response = await api.get(
        "/api/users"
      );

      if (response.data?.ok) {
        setUsers(
          response.data.users || []
        );
      }
    } catch (error) {
      console.error(
        "Users error:",
        error
      );
    } finally {
      setLoadingUsers(false);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | LOAD CONVERSATIONS
  |--------------------------------------------------------------------------
  */

  const loadConversations =
    async () => {
      try {
        setLoadingConversations(
          true
        );

        const response =
          await api.get(
            "/api/chat/conversations"
          );

        if (response.data?.ok) {
          setConversations(
            response.data
              .conversations || []
          );
        }
      } catch (error) {
        console.error(
          "Conversations error:",
          error
        );
      } finally {
        setLoadingConversations(
          false
        );
      }
    };

  /*
  |--------------------------------------------------------------------------
  | SEARCH
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    const query =
      searchText.trim();

    if (!query) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(
      () => {
        searchUsers(query);
      },
      350
    );

    return () => {
      clearTimeout(timer);
    };
  }, [searchText]);

  const searchUsers =
    async (query) => {
      try {
        setSearching(true);

        const response =
          await api.get(
            "/api/users/search",
            {
              params: {
                q: query,
              },
            }
          );

        if (response.data?.ok) {
          setSearchResults(
            response.data.users || []
          );
        }
      } catch (error) {
        console.error(
          "Search error:",
          error
        );
      } finally {
        setSearching(false);
      }
    };

  /*
  |--------------------------------------------------------------------------
  | OPEN NEW CONVERSATION
  |--------------------------------------------------------------------------
  */

  const openConversation =
    async (person) => {
      try {
        setLoadingMessages(true);

        const response =
          await api.post(
            "/api/chat/conversations",
            {
              user_id: person.id,
            }
          );

        if (!response.data?.ok) {
          throw new Error(
            response.data?.message ||
              "Unable to open conversation"
          );
        }

        const conversation = {
          ...response.data
            .conversation,

          user_id: person.id,
          full_name: person.full_name,
          email: person.email,

          profile_picture:
            person.profile_picture,

          is_online:
            Number(
              person.is_online
            ) === 1
              ? 1
              : 0,

          last_seen:
            person.last_seen,
        };

        setSelectedConversation(
          conversation
        );

        setSearchText("");
        setSearchResults([]);
        setMobileSidebar(false);
        setTypingUser(null);

        await loadMessages(
          conversation.id
        );

        await loadConversations();

        if (
          socketRef.current?.connected
        ) {
          socketRef.current.emit(
            "join_conversation",
            conversation.id
          );
        }

        await markAsRead(
          conversation.id
        );
      } catch (error) {
        console.error(
          "Open conversation error:",
          error
        );
      } finally {
        setLoadingMessages(false);
      }
    };

  /*
  |--------------------------------------------------------------------------
  | OPEN EXISTING CONVERSATION
  |--------------------------------------------------------------------------
  */

  const openExistingConversation =
    async (conversation) => {
      try {
        setSelectedConversation(
          conversation
        );

        setMobileSidebar(false);
        setLoadingMessages(true);
        setTypingUser(null);

        await loadMessages(
          conversation.id
        );

        if (
          socketRef.current?.connected
        ) {
          socketRef.current.emit(
            "join_conversation",
            conversation.id
          );
        }

        await markAsRead(
          conversation.id
        );
      } catch (error) {
        console.error(
          "Open existing conversation error:",
          error
        );
      } finally {
        setLoadingMessages(false);
      }
    };

  /*
  |--------------------------------------------------------------------------
  | LOAD MESSAGES
  |--------------------------------------------------------------------------
  */

  const loadMessages =
    async (conversationId) => {
      try {
        const response =
          await api.get(
            `/api/chat/conversations/${conversationId}/messages`
          );

        if (response.data?.ok) {
          setMessages(
            response.data.messages || []
          );

          setTimeout(
            scrollToBottom,
            50
          );
        }
      } catch (error) {
        console.error(
          "Messages error:",
          error
        );

        setMessages([]);
      }
    };

  /*
  |--------------------------------------------------------------------------
  | MARK READ
  |--------------------------------------------------------------------------
  */

  const markAsRead =
    async (conversationId) => {
      try {
        await api.post(
          `/api/chat/conversations/${conversationId}/read`
        );

        setMessages(
          (previous) =>
            previous.map(
              (message) =>
                Number(
                  message.sender_id
                ) !==
                Number(user?.id)
                  ? {
                      ...message,
                      is_read: 1,
                    }
                  : message
            )
        );
      } catch (error) {
        console.error(
          "Mark read error:",
          error
        );
      }
    };

  /*
  |--------------------------------------------------------------------------
  | SEND MESSAGE
  |--------------------------------------------------------------------------
  */

  const sendMessage =
    async (event) => {
      event?.preventDefault();

      const text =
        messageText.trim();

      if (
        !text ||
        !selectedConversation ||
        sending
      ) {
        return;
      }

      const conversationId =
        selectedConversation.id;

      setSending(true);

      /*
      |--------------------------------------------------------------------------
      | SOCKET MESSAGE
      |--------------------------------------------------------------------------
      */

      if (
        socketRef.current &&
        socketRef.current.connected
      ) {
        socketRef.current.emit(
          "send_message",
          {
            conversation_id:
              conversationId,

            message: text,

            message_type: "text",
          },
          (response) => {
            if (response?.ok) {
              setMessageText("");
              stopTyping();
            } else {
              console.error(
                response?.message ||
                  "Unable to send message"
              );
            }

            setSending(false);
          }
        );

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | REST FALLBACK
      |--------------------------------------------------------------------------
      */

      try {
        const response =
          await api.post(
            `/api/chat/conversations/${conversationId}/messages`,
            {
              message: text,
              message_type: "text",
            }
          );

        if (response.data?.ok) {
          const newMessage =
            response.data.message;

          setMessageText("");

          setMessages(
            (previous) => {
              const exists =
                previous.some(
                  (message) =>
                    String(
                      message.id
                    ) ===
                    String(
                      newMessage.id
                    )
                );

              return exists
                ? previous
                : [
                    ...previous,
                    newMessage,
                  ];
            }
          );

          await loadConversations();

          scrollToBottom();
        }
      } catch (error) {
        console.error(
          "Send message error:",
          error
        );
      } finally {
        setSending(false);
      }
    };

  /*
  |--------------------------------------------------------------------------
  | TYPING
  |--------------------------------------------------------------------------
  */

  const handleMessageChange =
    (event) => {
      const value =
        event.target.value;

      setMessageText(value);

      if (
        !socketRef.current?.connected ||
        !selectedConversation
      ) {
        return;
      }

      if (value.trim()) {
        socketRef.current.emit(
          "typing",
          selectedConversation.id
        );
      }

      clearTimeout(
        typingTimeoutRef.current
      );

      typingTimeoutRef.current =
        setTimeout(() => {
          stopTyping();
        }, 1200);
    };

  const stopTyping = () => {
    clearTimeout(
      typingTimeoutRef.current
    );

    if (
      socketRef.current?.connected &&
      selectedConversation
    ) {
      socketRef.current.emit(
        "stop_typing",
        selectedConversation.id
      );
    }
  };

  /*
  |--------------------------------------------------------------------------
  | LOGOUT
  |--------------------------------------------------------------------------
  */

  const logout = async () => {
    try {
      await api.post(
        "/api/auth/logout"
      );
    } catch (error) {
      console.error(
        "Logout error:",
        error
      );
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setUser(null);
    setSelectedConversation(null);
    setMessages([]);
    setConversations([]);
    setUsers([]);
    setSearchResults([]);
    setSearchText("");
    setTypingUser(null);
    setShowProfile(false);
  };

  /*
  |--------------------------------------------------------------------------
  | AUTH SUBMIT
  |--------------------------------------------------------------------------
  */

  const handleAuthSubmit =
    async (event) => {
      event.preventDefault();

      setAuthError("");
      setAuthMessage("");

      if (
        !email.trim() ||
        !password
      ) {
        setAuthError(
          "Please fill in all required fields."
        );

        return;
      }

      if (
        authMode === "signup" &&
        !fullName.trim()
      ) {
        setAuthError(
          "Please enter your full name."
        );

        return;
      }

      try {
        setAuthSubmitting(true);

        const endpoint =
          authMode === "signup"
            ? "/api/auth/signup"
            : "/api/auth/signin";

        const body =
          authMode === "signup"
            ? {
                full_name:
                  fullName.trim(),

                email:
                  email
                    .trim()
                    .toLowerCase(),

                password,
              }
            : {
                email:
                  email
                    .trim()
                    .toLowerCase(),

                password,
              };

        const response =
          await api.post(
            endpoint,
            body
          );

        if (!response.data?.ok) {
          throw new Error(
            response.data?.message ||
              "Authentication failed."
          );
        }

        if (
          authMode === "signup"
        ) {
          setAuthMessage(
            "Account created successfully. Please sign in."
          );

          setAuthMode("signin");
          setPassword("");
        } else {
          setUser(
            response.data.user
          );

          setEmail("");
          setPassword("");
          setFullName("");
          setAuthError("");
        }
      } catch (error) {
        setAuthError(
          error.response?.data
            ?.message ||
            error.message ||
            "Something went wrong."
        );
      } finally {
        setAuthSubmitting(false);
      }
    };

  /*
  |--------------------------------------------------------------------------
  | SCROLL
  |--------------------------------------------------------------------------
  */

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView(
      {
        behavior: "smooth",
      }
    );
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  /*
  |--------------------------------------------------------------------------
  | FORMAT TIME
  |--------------------------------------------------------------------------
  */

  const formatTime = (date) => {
    if (!date) {
      return "";
    }

    const parsed =
      new Date(date);

    if (
      Number.isNaN(
        parsed.getTime()
      )
    ) {
      return "";
    }

    return parsed.toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  };

  /*
  |--------------------------------------------------------------------------
  | FORMAT DATE
  |--------------------------------------------------------------------------
  */

  const formatDate = (date) => {
    if (!date) {
      return "";
    }

    const parsed =
      new Date(date);

    if (
      Number.isNaN(
        parsed.getTime()
      )
    ) {
      return "";
    }

    return parsed.toLocaleDateString(
      [],
      {
        day: "numeric",
        month: "short",
        year: "numeric",
      }
    );
  };

  /*
  |--------------------------------------------------------------------------
  | INITIALS
  |--------------------------------------------------------------------------
  */

  const getInitials = (name) => {
    if (!name) {
      return "U";
    }

    return name
      .trim()
      .split(/\s+/)
      .map(
        (part) => part[0]
      )
      .join("")
      .slice(0, 2)
      .toUpperCase();
  };

  /*
  |--------------------------------------------------------------------------
  | LAST MESSAGE
  |--------------------------------------------------------------------------
  */

  const getLastMessage =
    (conversation) => {
      if (
        conversation?.last_message
      ) {
        return conversation.last_message;
      }

      return "Start chatting";
    };

  /*
  |--------------------------------------------------------------------------
  | DISPLAY CONVERSATIONS
  |--------------------------------------------------------------------------
  */

  const displayedConversations =
    useMemo(() => {
      return [
        ...conversations,
      ].sort((a, b) => {
        const dateA =
          new Date(
            a.updated_at ||
              a.created_at ||
              0
          ).getTime();

        const dateB =
          new Date(
            b.updated_at ||
              b.created_at ||
              0
          ).getTime();

        return dateB - dateA;
      });
    }, [conversations]);

  /*
  |--------------------------------------------------------------------------
  | LOADING SCREEN
  |--------------------------------------------------------------------------
  */

  if (authLoading) {
    return (
      <div className="app-loading">
        <div className="loading-logo">
          UC
        </div>

        <Loader2
          size={28}
          className="spin"
        />

        <p>
          Loading UC Chat...
        </p>
      </div>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | AUTH SCREEN
  |--------------------------------------------------------------------------
  */

  if (!user) {
    return (
      <div className="auth-page">
        <div className="auth-background">
          <div className="glow glow-one" />
          <div className="glow glow-two" />
        </div>

        <div className="auth-container">
          <div className="auth-brand">
            <div className="brand-mark">
              UC
            </div>

            <div>
              <h1>
                UC Chat
              </h1>

              <p>
                Connect. Chat. Communicate.
              </p>
            </div>
          </div>

          <div className="auth-card">
            <div className="auth-heading">
              <h2>
                {authMode ===
                "signin"
                  ? "Welcome back"
                  : "Create your account"}
              </h2>

              <p>
                {authMode ===
                "signin"
                  ? "Sign in to continue to UC Chat."
                  : "Join UC Chat and start communicating."}
              </p>
            </div>

            {authError && (
              <div className="auth-alert error">
                {authError}
              </div>
            )}

            {authMessage && (
              <div className="auth-alert success">
                {authMessage}
              </div>
            )}

            <form
              className="auth-form"
              onSubmit={
                handleAuthSubmit
              }
            >
              {authMode ===
                "signup" && (
                <div className="field">
                  <label>
                    Full name
                  </label>

                  <input
                    type="text"
                    placeholder="Enter your full name"
                    value={
                      fullName
                    }
                    onChange={(
                      event
                    ) =>
                      setFullName(
                        event.target
                          .value
                      )
                    }
                    autoComplete="name"
                  />
                </div>
              )}

              <div className="field">
                <label>
                  Email
                </label>

                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(
                    event
                  ) =>
                    setEmail(
                      event.target
                        .value
                    )
                  }
                  autoComplete="email"
                />
              </div>

              <div className="field">
                <label>
                  Password
                </label>

                <input
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(
                    event
                  ) =>
                    setPassword(
                      event.target
                        .value
                    )
                  }
                  autoComplete={
                    authMode ===
                    "signin"
                      ? "current-password"
                      : "new-password"
                  }
                />
              </div>

              <button
                type="submit"
                className="auth-submit"
                disabled={
                  authSubmitting
                }
              >
                {authSubmitting ? (
                  <>
                    <Loader2
                      size={18}
                      className="spin"
                    />

                    Processing...
                  </>
                ) : authMode ===
                  "signin" ? (
                  "Sign In"
                ) : (
                  "Create Account"
                )}
              </button>
            </form>

            <div className="auth-switch">
              <span>
                {authMode ===
                "signin"
                  ? "Don't have an account?"
                  : "Already have an account?"}
              </span>

              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setAuthMessage("");

                  setAuthMode(
                    authMode ===
                      "signin"
                      ? "signup"
                      : "signin"
                  );
                }}
              >
                {authMode ===
                "signin"
                  ? "Create account"
                  : "Sign in"}
              </button>
            </div>
          </div>

          <div className="auth-footer">
            <span>
              ©{" "}
              {new Date().getFullYear()}{" "}
              UC Chat
            </span>

            <span>
              Secure conversations
            </span>
          </div>
        </div>
      </div>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | CHAT SCREEN
  |--------------------------------------------------------------------------
  */

  return (
    <div className="chat-app">

      {/* SIDEBAR */}

      <aside
        className={`chat-sidebar ${
          mobileSidebar
            ? "sidebar-visible"
            : "sidebar-hidden"
        }`}
      >
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="brand-mark small">
              UC
            </div>

            <div>
              <h1>
                UC Chat
              </h1>

              <span>
                Connect. Chat. Communicate.
              </span>
            </div>
          </div>

          <button
            className="icon-button"
            onClick={() =>
              setShowProfile(
                (previous) =>
                  !previous
              )
            }
            title="Profile"
            type="button"
          >
            <MoreVertical
              size={20}
            />
          </button>
        </div>

        {/* PROFILE */}

        {showProfile && (
          <div className="profile-popup">
            <div className="profile-avatar">
              {getInitials(
                user.full_name
              )}
            </div>

            <div className="profile-info">
              <strong>
                {user.full_name}
              </strong>

              <span>
                {user.email}
              </span>
            </div>

            <button
              className="logout-button"
              onClick={logout}
              type="button"
            >
              <LogOut
                size={17}
              />

              Logout
            </button>
          </div>
        )}

        {/* SEARCH */}

        <div className="search-container">
          <Search
            size={18}
          />

          <input
            type="text"
            placeholder="Search people..."
            value={searchText}
            onChange={(
              event
            ) =>
              setSearchText(
                event.target.value
              )
            }
          />

          {searchText && (
            <button
              className="search-clear"
              onClick={() => {
                setSearchText("");
                setSearchResults([]);
              }}
              type="button"
            >
              <X
                size={16}
              />
            </button>
          )}
        </div>

        {/* SEARCH RESULTS */}

        {searchText ? (
          <div className="search-results">
            <div className="section-title">
              <span>
                Search results
              </span>

              {searching && (
                <Loader2
                  size={15}
                  className="spin"
                />
              )}
            </div>

            {!searching &&
              searchResults.length ===
                0 && (
                <div className="empty-small">
                  No users found
                </div>
              )}

            {searchResults.map(
              (person) => (
                <button
                  key={
                    person.id
                  }
                  className="user-result"
                  type="button"
                  onClick={() =>
                    openConversation(
                      person
                    )
                  }
                >
                  <div className="avatar-wrapper">
                    <div className="avatar">
                      {getInitials(
                        person.full_name
                      )}
                    </div>

                    {Number(
                      person.is_online
                    ) === 1 && (
                      <span className="online-dot" />
                    )}
                  </div>

                  <div className="user-result-info">
                    <strong>
                      {
                        person.full_name
                      }
                    </strong>

                    <span>
                      {Number(
                        person.is_online
                      ) === 1
                        ? "Online"
                        : person.last_seen
                          ? `Last seen ${formatDate(
                              person.last_seen
                            )}`
                          : person.email}
                    </span>
                  </div>

                  <MessageCircle
                    size={17}
                  />
                </button>
              )
            )}
          </div>
        ) : (
          /* CONVERSATIONS */

          <div className="conversation-area">
            <div className="section-title">
              <span>
                Conversations
              </span>

              <span className="count">
                {
                  displayedConversations.length
                }
              </span>
            </div>

            {loadingConversations ? (
              <div className="center-loading">
                <Loader2
                  size={24}
                  className="spin"
                />

                <span>
                  Loading chats...
                </span>
              </div>
            ) : displayedConversations.length ===
              0 ? (
              <div className="empty-conversations">
                <div className="empty-icon">
                  <MessageCircle
                    size={28}
                  />
                </div>

                <h3>
                  No conversations yet
                </h3>

                <p>
                  Search for someone above
                  to start chatting.
                </p>
              </div>
            ) : (
              displayedConversations.map(
                (
                  conversation
                ) => (
                  <button
                    key={
                      conversation.id
                    }
                    className={`conversation-item ${
                      String(
                        selectedConversation?.id
                      ) ===
                      String(
                        conversation.id
                      )
                        ? "active"
                        : ""
                    }`}
                    type="button"
                    onClick={() =>
                      openExistingConversation(
                        conversation
                      )
                    }
                  >
                    <div className="avatar-wrapper">
                      <div className="avatar">
                        {getInitials(
                          conversation.full_name
                        )}
                      </div>

                      {Number(
                        conversation.is_online
                      ) === 1 && (
                        <span className="online-dot" />
                      )}
                    </div>

                    <div className="conversation-info">
                      <div className="conversation-top">
                        <strong>
                          {
                            conversation.full_name
                          }
                        </strong>

                        {conversation.updated_at && (
                          <time>
                            {formatTime(
                              conversation.updated_at
                            )}
                          </time>
                        )}
                      </div>

                      <div className="conversation-bottom">
                        <span>
                          {getLastMessage(
                            conversation
                          )}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              )
            )}
          </div>
        )}

        {/* SIDEBAR FOOTER */}

        <div className="sidebar-footer">
          <div className="current-user">
            <div className="avatar small-avatar">
              {getInitials(
                user.full_name
              )}
            </div>

            <div>
              <strong>
                {user.full_name}
              </strong>

              <span>
                Online
              </span>
            </div>
          </div>

          <button
            className="footer-icon"
            onClick={logout}
            title="Logout"
            type="button"
          >
            <LogOut
              size={18}
            />
          </button>
        </div>
      </aside>

      {/* CHAT PANEL */}

      <main
        className={`chat-panel ${
          mobileSidebar
            ? "chat-panel-hidden-mobile"
            : ""
        }`}
      >
        {selectedConversation ? (
          <>
            {/* CHAT HEADER */}

            <header className="chat-header">
              <div className="chat-header-user">
                <button
                  className="mobile-back"
                  type="button"
                  onClick={() => {
                    setMobileSidebar(
                      true
                    );

                    stopTyping();
                  }}
                >
                  <ArrowLeft
                    size={20}
                  />
                </button>

                <div className="avatar-wrapper">
                  <div className="avatar">
                    {getInitials(
                      selectedConversation.full_name
                    )}
                  </div>

                  {Number(
                    selectedConversation.is_online
                  ) === 1 && (
                    <span className="online-dot" />
                  )}
                </div>

                <div className="chat-header-info">
                  <h2>
                    {
                      selectedConversation.full_name
                    }
                  </h2>

                  {typingUser ? (
                    <span className="typing-status">
                      typing...
                    </span>
                  ) : Number(
                      selectedConversation.is_online
                    ) === 1 ? (
                    <span className="online-status-text">
                      Online
                    </span>
                  ) : selectedConversation.last_seen ? (
                    <span className="offline-status-text">
                      Last seen{" "}
                      {formatDate(
                        selectedConversation.last_seen
                      )}{" "}
                      at{" "}
                      {formatTime(
                        selectedConversation.last_seen
                      )}
                    </span>
                  ) : (
                    <span className="offline-status-text">
                      Offline
                    </span>
                  )}
                </div>
              </div>

              <div className="chat-header-actions">
                <button
                  className="icon-button"
                  type="button"
                  title="Search messages"
                >
                  <Search
                    size={19}
                  />
                </button>

                <button
                  className="icon-button"
                  type="button"
                  title="More"
                >
                  <MoreVertical
                    size={19}
                  />
                </button>
              </div>
            </header>

            {/* MESSAGES */}

            <div className="messages-area">
              {loadingMessages ? (
                <div className="messages-loading">
                  <Loader2
                    size={30}
                    className="spin"
                  />

                  <span>
                    Loading messages...
                  </span>
                </div>
              ) : messages.length ===
                0 ? (
                <div className="empty-chat">
                  <div className="empty-chat-avatar">
                    {getInitials(
                      selectedConversation.full_name
                    )}
                  </div>

                  <h2>
                    Start a conversation
                  </h2>

                  <p>
                    Send a message to{" "}
                    {
                      selectedConversation.full_name
                    }
                  </p>
                </div>
              ) : (
                <div className="message-list">
                  <div className="date-divider">
                    <span>
                      Today
                    </span>
                  </div>

                  {messages.map(
                    (message) => {
                      const isMine =
                        Number(
                          message.sender_id
                        ) ===
                        Number(
                          user.id
                        );

                      return (
                        <div
                          key={
                            message.id
                          }
                          className={`message-row ${
                            isMine
                              ? "mine"
                              : "theirs"
                          }`}
                        >
                          <div className="message-bubble">
                            <p>
                              {
                                message.message
                              }
                            </p>

                            <div className="message-meta">
                              <time>
                                {formatTime(
                                  message.created_at
                                )}
                              </time>

                              {isMine &&
                                (Number(
                                  message.is_read
                                ) === 1 ? (
                                  <CheckCheck
                                    size={
                                      15
                                    }
                                  />
                                ) : (
                                  <Check
                                    size={
                                      15
                                    }
                                  />
                                ))}
                            </div>
                          </div>
                        </div>
                      );
                    }
                  )}

                  <div
                    ref={
                      messagesEndRef
                    }
                  />
                </div>
              )}
            </div>

            {/* TYPING */}

            {typingUser && (
              <div className="typing-indicator">
                <span />
                <span />
                <span />

                <label>
                  {
                    typingUser.full_name
                  }{" "}
                  is typing...
                </label>
              </div>
            )}

            {/* MESSAGE FORM */}

            <form
              className="message-form"
              onSubmit={
                sendMessage
              }
            >
              <button
                type="button"
                className="message-tool"
                title="Attach file"
              >
                <Paperclip
                  size={20}
                />
              </button>

              <div className="message-input-wrapper">
                <input
                  type="text"
                  placeholder="Write a message..."
                  value={
                    messageText
                  }
                  onChange={
                    handleMessageChange
                  }
                  onBlur={
                    stopTyping
                  }
                  maxLength={5000}
                />

                <button
                  type="button"
                  className="emoji-button"
                  title="Emoji"
                >
                  <Smile
                    size={19}
                  />
                </button>
              </div>

              <button
                type="submit"
                className="send-button"
                disabled={
                  !messageText.trim() ||
                  sending
                }
                title="Send message"
              >
                {sending ? (
                  <Loader2
                    size={19}
                    className="spin"
                  />
                ) : (
                  <Send
                    size={19}
                  />
                )}
              </button>
            </form>
          </>
        ) : (
          /* WELCOME */

          <div className="welcome-panel">
            <div className="welcome-icon">
              <MessageCircle
                size={46}
              />
            </div>

            <h1>
              Welcome to UC Chat
            </h1>

            <p>
              Connect with people,
              start conversations,
              and communicate in real time.
            </p>

            <div className="welcome-features">
              <div>
                <MessageCircle
                  size={20}
                />

                <span>
                  Real-time messaging
                </span>
              </div>

              <div>
                <Users
                  size={20}
                />

                <span>
                  Find people
                </span>
              </div>

              <div>
                <CheckCheck
                  size={20}
                />

                <span>
                  Message status
                </span>
              </div>
            </div>

            <button
              className="start-chat-button"
              type="button"
              onClick={() => {
                setMobileSidebar(
                  true
                );

                setTimeout(() => {
                  document
                    .querySelector(
                      ".search-container input"
                    )
                    ?.focus();
                }, 100);
              }}
            >
              <UserPlus
                size={18}
              />

              Start a new chat
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;