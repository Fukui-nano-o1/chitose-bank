import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatView } from '../../../src/components/ChatView';
import { ChatList } from '../../../src/components/ChatList';
import { AdminChatPage } from '../../../src/components/AdminChat';
import { clearChatDrafts } from '../../../src/lib/chatDrafts';
import { CSS } from '../../../src/appStyles';
const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
function Harness() {
 const [route,setRoute] = useState(window.qaRoute || 'list');
 const [account,setAccount] = useState(window.qaUser);
 window.qaNavigate=setRoute;
 window.qaAccount = value => { window.qaUser=value; setAccount(value); clearChatDrafts(); };
 return route === 'list' ? <ChatList key={account}/> : route === 'admin' ? <AdminChatPage key={account+route} onBack={() => setRoute('list')}/> : <ChatView key={account+route} applicationId={route} onBack={() => setRoute('list')}/>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
