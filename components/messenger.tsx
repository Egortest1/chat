'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';

type Profile = { id: string; username: string; display_name: string; bio: string; avatar_color: string };
type Message = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string };
type Chat = { id: string; peer: Profile; lastMessage?: Message };
const colors = ['#7c6cf2', '#e77b9b', '#399b8c', '#df9b4b', '#5f87d7', '#b26bcb'];
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || '?';
const clock = (value: string) => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const shortDate = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(value));

export default function Messenger() {
  const supabase = useMemo(() => getSupabase(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [notice, setNotice] = useState('');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [mobileList, setMobileList] = useState(true);
  const [draftName, setDraftName] = useState('');
  const [draftBio, setDraftBio] = useState('');
  const [draftColor, setDraftColor] = useState(colors[0]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const user = session?.user ?? null;
  const selectedChat = chats.find((chat) => chat.id === selectedId) ?? null;

  const loadProfile = useCallback(async (currentUser: User) => {
    if (!supabase) return;
    const { data } = await supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    if (data) {
      const p = data as Profile;
      setProfile(p); setDraftName(p.display_name); setDraftBio(p.bio || ''); setDraftColor(p.avatar_color || colors[0]);
    }
  }, [supabase]);

  const loadInbox = useCallback(async () => {
    if (!supabase || !user) return;
    const { data: ownRows, error } = await supabase.from('conversation_members').select('conversation_id').eq('user_id', user.id);
    if (error || !ownRows?.length) { setChats([]); return; }
    const ids = [...new Set(ownRows.map((row) => row.conversation_id as string))];
    const { data: memberRows } = await supabase.from('conversation_members').select('conversation_id,user_id').in('conversation_id', ids).neq('user_id', user.id);
    const peerIds = [...new Set((memberRows || []).map((row) => row.user_id as string))];
    if (!peerIds.length) { setChats([]); return; }
    const [{ data: people }, { data: recent }] = await Promise.all([
      supabase.from('profiles').select('id,username,display_name,bio,avatar_color').in('id', peerIds),
      supabase.from('messages').select('*').in('conversation_id', ids).order('created_at', { ascending: false }).limit(200),
    ]);
    const peopleById = new Map((people || []).map((p) => [p.id, p as Profile]));
    const latestByConversation = new Map<string, Message>();
    for (const msg of (recent || []) as Message[]) if (!latestByConversation.has(msg.conversation_id)) latestByConversation.set(msg.conversation_id, msg);
    const rows: Chat[] = (memberRows || []).flatMap((row) => {
      const peer = peopleById.get(row.user_id as string);
      if (!peer) return [];
      return [{ id: row.conversation_id as string, peer, lastMessage: latestByConversation.get(row.conversation_id as string) }];
    });
    const unique = [...new Map(rows.map((chat) => [chat.id, chat])).values()];
    unique.sort((a, b) => (b.lastMessage?.created_at || '').localeCompare(a.lastMessage?.created_at || ''));
    setChats(unique);
    setSelectedId((previous) => unique.some((chat) => chat.id === previous) ? previous : unique[0]?.id || '');
  }, [supabase, user]);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!supabase || !conversationId) { setMessages([]); return; }
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(500);
    setMessages((data || []) as Message[]);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) { setSession(data.session); setLoading(false); } });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession); setLoading(false);
      if (!nextSession) { setProfile(null); setChats([]); setMessages([]); setSelectedId(''); }
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, [supabase]);

  useEffect(() => { if (user) { void loadProfile(user); void loadInbox(); } }, [user, loadProfile, loadInbox]);
  useEffect(() => { if (selectedId) void loadMessages(selectedId); }, [selectedId, loadMessages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (!supabase || !selectedId) return;
    const channel = supabase.channel(`conversation-${selectedId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedId}` }, (payload) => {
      const incoming = payload.new as Message;
      setMessages((current) => current.some((message) => message.id === incoming.id) ? current : [...current, incoming]);
      void loadInbox();
    }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, selectedId, loadInbox]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return;
    setAuthBusy(true); setAuthError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim(); const password = String(form.get('password') || '');
    if (authMode === 'signup') {
      const displayName = String(form.get('displayName') || '').trim();
      const rawUsername = String(form.get('username') || '').trim().toLowerCase().replace(/^@/, '');
      const username = rawUsername.replace(/[^a-z0-9_]/g, '').slice(0, 24);
      if (username.length < 3) { setAuthError('Имя пользователя: минимум 3 символа (латиница, цифры и _).'); setAuthBusy(false); return; }
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName, username } } });
      if (error) setAuthError(error.message);
      else if (!data.session) setNotice('Проверьте почту и подтвердите адрес, затем войдите в аккаунт.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) setAuthError(error.message);
    }
    setAuthBusy(false);
  }

  async function searchPeople(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !search.trim()) return;
    setSearching(true); setResults([]);
    const term = search.trim().replace(/[%_,]/g, '');
    const [{ data: byName }, { data: byHandle }] = await Promise.all([
      supabase.from('profiles').select('id,username,display_name,bio,avatar_color').ilike('display_name', `%${term}%`).limit(12),
      supabase.from('profiles').select('id,username,display_name,bio,avatar_color').ilike('username', `%${term}%`).limit(12),
    ]);
    const found = [...(byName || []), ...(byHandle || [])].filter((p) => p.id !== user?.id);
    setResults([...new Map(found.map((p) => [p.id, p as Profile])).values()]); setSearching(false);
  }

  async function startChat(peer: Profile) {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('start_conversation', { target_user: peer.id });
    if (error) { setNotice(error.message); return; }
    const id = data as string; await loadInbox(); setSelectedId(id); setMobileList(false); setResults([]); setSearch(''); setNotice('');
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const body = text.trim(); if (!supabase || !user || !selectedId || !body) return;
    setText('');
    const { error } = await supabase.from('messages').insert({ conversation_id: selectedId, sender_id: user.id, body });
    if (error) { setText(body); setNotice(error.message); } else { void loadInbox(); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !user || !profile) return;
    const display_name = draftName.trim(); const bio = draftBio.trim();
    if (!display_name) { setNotice('Имя не может быть пустым.'); return; }
    const { data, error } = await supabase.from('profiles').update({ display_name, bio, avatar_color: draftColor }).eq('id', user.id).select().single();
    if (error) setNotice(error.message); else { setProfile(data as Profile); setShowProfile(false); setNotice('Профиль обновлён.'); }
  }

  async function signOut() { if (supabase) await supabase.auth.signOut(); }

  if (!supabase) return <main className="setup-screen"><div className="setup-card"><div className="brand-mark">s.</div><p className="kicker">САЛОН · НАСТРОЙКА ПРОЕКТА</p><h1>Подключите базу данных</h1><p>Добавьте URL и публичный anon key вашего проекта Supabase в переменные окружения, затем запустите приложение ещё раз.</p><code>NEXT_PUBLIC_SUPABASE_URL<br />NEXT_PUBLIC_SUPABASE_ANON_KEY</code><p className="muted">Инструкция и SQL-схема находятся в README.md и supabase/schema.sql.</p></div></main>;

  if (loading) return <main className="loading-screen"><div className="spinner" />Загружаем ваш салон…</main>;
  if (!user) return <main className="auth-screen"><div className="auth-decoration"><div className="orb orb-one"/><div className="orb orb-two"/><span className="deco-star">✳</span><div className="auth-quote">«Искусство разговора —<br />это искусство слушать.»<small>САЛОН · МЕСТО ДЛЯ СВОИХ</small></div></div><section className="auth-panel"><div className="auth-brand"><span className="brand-mark">s.</span><span>салон</span></div><div className="auth-form-wrap"><p className="kicker">ВАШЕ ПРОСТРАНСТВО ОБЩЕНИЯ</p><h1>{authMode === 'login' ? 'С возвращением' : 'Создайте аккаунт'}</h1><p className="auth-intro">{authMode === 'login' ? 'Войдите, чтобы продолжить разговор.' : 'Заведите профиль и найдите своих людей.'}</p><form onSubmit={submitAuth} className="form-stack">{authMode === 'signup' && <><label>Как к вам обращаться<input name="displayName" required minLength={2} maxLength={40} placeholder="Например, Алина" /></label><label>Имя пользователя<input name="username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" placeholder="alina_" /><small>Латиница, цифры и подчёркивание</small></label></>}<label>Электронная почта<input type="email" name="email" required autoComplete="email" placeholder="you@example.com" /></label><label>Пароль<input type="password" name="password" required minLength={6} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} placeholder="Не менее 6 символов" /></label>{authError && <p className="form-error">{authError}</p>}{notice && <p className="form-success">{notice}</p>}<button className="primary-button" disabled={authBusy}>{authBusy ? 'Секунду…' : authMode === 'login' ? 'Войти в салон' : 'Зарегистрироваться'}<span>↗</span></button></form><p className="auth-switch">{authMode === 'login' ? 'Впервые здесь?' : 'Уже есть аккаунт?'} <button onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(''); setNotice(''); }}>{authMode === 'login' ? 'Создать аккаунт' : 'Войти'}</button></p><p className="auth-terms">Продолжая, вы соглашаетесь общаться бережно и уважительно.</p></div></section></main>;

  return <main className="app-shell"><aside className={`sidebar ${mobileList ? 'mobile-visible' : ''}`}><div className="sidebar-top"><a className="brand" href="#"><span className="brand-mark">s.</span><span>салон<small>МЕСТО ДЛЯ СВОИХ</small></span></a><button className="new-chat" onClick={() => { setResults([]); setSearch(''); document.getElementById('people-search')?.focus(); }} aria-label="Новый чат">＋</button></div><form className="search-box" onSubmit={searchPeople}><span>⌕</span><input id="people-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск людей"/><button aria-label="Искать">↵</button></form>{notice && <div className="inline-notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}{results.length > 0 && <div className="search-results"><div className="list-caption">НАЙДЕНЫ В САЛОНЕ</div>{results.map((person) => <button key={person.id} className="search-person" onClick={() => void startChat(person)}><Avatar profile={person}/><span><b>{person.display_name}</b><small>@{person.username}</small></span><i>＋</i></button>)}</div>}<div className="list-caption inbox-label">ВАШИ ДИАЛОГИ <span>{chats.length}</span></div><div className="chat-list">{chats.map((chat) => <button key={chat.id} className={`chat-item ${selectedId === chat.id ? 'active' : ''}`} onClick={() => { setSelectedId(chat.id); setMobileList(false); }}><Avatar profile={chat.peer}/><span className="chat-item-copy"><b>{chat.peer.display_name}</b><small>{chat.lastMessage ? `${chat.lastMessage.sender_id === user.id ? 'Вы: ' : ''}${chat.lastMessage.body}` : 'Начните разговор'}</small></span><time>{chat.lastMessage ? clock(chat.lastMessage.created_at) : ''}</time></button>)}{chats.length === 0 && <div className="empty-inbox"><div>✳</div><b>Пока тихо</b><span>Найдите собеседника<br />по имени или @нику.</span></div>}</div><div className="sidebar-bottom"><button className="my-profile" onClick={() => setShowProfile(true)}><Avatar profile={profile}/><span><b>{profile?.display_name || 'Ваш профиль'}</b><small>Настроить профиль</small></span><span className="more">···</span></button><button className="signout" onClick={signOut}>↗ <span>Выйти из аккаунта</span></button></div></aside>
  <section className={`chat-panel ${mobileList ? 'mobile-hidden' : ''}`}>{selectedChat ? <><header className="chat-topbar"><button className="back-button" onClick={() => setMobileList(true)}>‹</button><Avatar profile={selectedChat.peer}/><div className="chat-person"><b>{selectedChat.peer.display_name}</b><small>@{selectedChat.peer.username}</small></div><div className="online-state"><i/>в вашем салоне</div><button className="header-more" aria-label="Информация">···</button></header><div className="message-area"><div className="conversation-start"><Avatar profile={selectedChat.peer} large/><h2>{selectedChat.peer.display_name}</h2><p>@{selectedChat.peer.username} · ваш собеседник</p><span>Вы можете начать разговор прямо сейчас</span></div><div className="message-list">{messages.map((message, index) => {const mine = message.sender_id === user.id; const previous = messages[index - 1]; const showDate = !previous || new Date(previous.created_at).toDateString() !== new Date(message.created_at).toDateString(); return <div key={message.id}>{showDate && <div className="date-divider"><span>{shortDate(message.created_at)}</span></div>}<div className={`message-row ${mine ? 'mine' : ''}`}><div className="message-bubble">{message.body}<time>{clock(message.created_at)}{mine && <span className="read-mark"> ·✓</span>}</time></div></div></div>;})}<div ref={bottomRef}/></div></div><form className="composer" onSubmit={sendMessage}><textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Напишите сообщение…" rows={1} maxLength={4000}/><div className="composer-bottom"><span>Enter — отправить · Shift + Enter — новая строка</span><button disabled={!text.trim()} aria-label="Отправить сообщение">↑</button></div></form></> : <div className="welcome-panel"><div className="welcome-icon">✳</div><p className="kicker">ДОБРО ПОЖАЛОВАТЬ В САЛОН</p><h1>Разговор начинается<br/>с одного сообщения.</h1><p>Найдите человека по имени или нику —<br/>и откройте новый диалог.</p><button className="primary-button" onClick={() => { setMobileList(true); document.getElementById('people-search')?.focus(); }}>Найти собеседника <span>↗</span></button></div>}</section>
  {showProfile && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowProfile(false); }}><section className="profile-modal"><div className="modal-heading"><div><p className="kicker">ВАШЕ ПРЕДСТАВИТЕЛЬСТВО</p><h2>Профиль</h2></div><button onClick={() => setShowProfile(false)} aria-label="Закрыть">×</button></div><form onSubmit={saveProfile}><div className="profile-preview"><div className="avatar avatar-large" style={{ background: draftColor }}>{initials(draftName || '?')}</div><span>Так вас видят собеседники</span></div><label>Имя<input value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={40} required/></label><label>О себе<textarea value={draftBio} onChange={(e) => setDraftBio(e.target.value)} maxLength={160} rows={3} placeholder="Пара слов о вас"/></label><fieldset><legend>Цвет аватара</legend><div className="color-options">{colors.map((color) => <button type="button" key={color} className={draftColor === color ? 'chosen' : ''} style={{ background: color }} onClick={() => setDraftColor(color)} aria-label={`Выбрать цвет ${color}`}/>)}</div></fieldset><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowProfile(false)}>Отмена</button><button className="primary-button">Сохранить</button></div></form></section></div>}</main>;
}

function Avatar({ profile, large = false }: { profile: Profile | null; large?: boolean }) {
  return <span className={`avatar ${large ? 'avatar-large' : ''}`} style={{ background: profile?.avatar_color || colors[0] }}>{initials(profile?.display_name || '?')}</span>;
}
