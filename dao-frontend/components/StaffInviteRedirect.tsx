'use client';
import { useEffect } from 'react';
// Auth invites return to the existing allowlisted site root. The credential
// remains in the fragment and is processed by the standard Supabase client.
export default function StaffInviteRedirect(){useEffect(()=>{if(new URLSearchParams(window.location.hash.slice(1)).get('type')==='invite')window.location.replace('/auth/activate-staff'+window.location.hash);},[]);return null;}
