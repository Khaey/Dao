'use client';
import { useParams } from 'next/navigation';
import ReviewEditor from '../../../../../components/backoffice/ReviewEditor';
export default function Page(){const {id}=useParams<{id:string}>();return <ReviewEditor projectId={id} />;}
