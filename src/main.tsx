import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarPage } from './features/calendar';
import { AdminPage } from './features/admin';
import './styles.css';
import { initializeTheme } from './features/theme';

initializeTheme();

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<StrictMode>{window.location.pathname.replace(/\/$/, '') === '/admin' ? <AdminPage /> : <CalendarPage />}</StrictMode>);
