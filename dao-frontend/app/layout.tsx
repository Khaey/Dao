import './globals.css';
import { Inter } from 'next/font/google';
import AssistantWidget from '../components/assistant/AssistantWidget';
export const metadata={title:'D.A.O — Transparence, précision, confiance'};
// Inter with tabular figures (see globals.css) keeps amounts and dates aligned in tables.
const inter=Inter({subsets:['latin'],display:'swap',variable:'--font-inter'});
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fr" className={inter.variable}><body>{children}<AssistantWidget /></body></html>}
