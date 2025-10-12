import { db } from '../firebase';
import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  writeBatch,
} from 'firebase/firestore';

const chaptersCol = (bookId) => collection(db, `books/${bookId}/chapters`);
const chapterDoc = (bookId, chapterId) => doc(db, `books/${bookId}/chapters/${chapterId}`);
const subchaptersCol = (bookId, chapterId) => collection(db, `books/${bookId}/chapters/${chapterId}/subchapters`);
const subchapterDoc = (bookId, chapterId, subId) => doc(db, `books/${bookId}/chapters/${chapterId}/subchapters/${subId}`);

export async function getChapters(bookId) {
  const q = query(chaptersCol(bookId), orderBy('order'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getSubchapters(bookId, chapterId) {
  const q = query(subchaptersCol(bookId, chapterId), orderBy('order'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addChapter(bookId, { title, slug, contentHtml, order }) {
  // If no order specified, get the next available order number
  if (!order) {
    const existingChapters = await getChapters(bookId);
    const maxOrder = existingChapters.length > 0 ? Math.max(...existingChapters.map(c => c.order || 0)) : 0;
    order = maxOrder + 100;
  }
  
  return addDoc(chaptersCol(bookId), {
    title,
    slug: slug ?? title?.toLowerCase().replace(/\s+/g, '-'),
    contentHtml: contentHtml ?? '',
    order,
    isPublished: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateChapter(bookId, chapterId, data) {
  console.log('updateChapter called with:', data);
  const updateData = { ...data, updatedAt: serverTimestamp() };
  console.log('updateData being sent to Firestore:', updateData);
  return updateDoc(chapterDoc(bookId, chapterId), updateData);
}

export async function deleteChapter(bookId, chapterId) {
  // Note: for nested deletes of many subchapters, consider Cloud Function.
  return deleteDoc(chapterDoc(bookId, chapterId));
}

export async function addSubchapter(bookId, chapterId, { title, slug, contentHtml, contentDelta, order, audioUrl, wordTimings }) {
  // If no order specified, get the next available order number
  if (!order) {
    const existingSubchapters = await getSubchapters(bookId, chapterId);
    const maxOrder = existingSubchapters.length > 0 ? Math.max(...existingSubchapters.map(s => s.order || 0)) : 0;
    order = maxOrder + 100;
  }
  
  return addDoc(subchaptersCol(bookId, chapterId), {
    title,
    slug: slug ?? title?.toLowerCase().replace(/\s+/g, '-'),
    contentHtml: contentHtml ?? '',
    contentDelta: contentDelta ?? null,
    audioUrl: audioUrl ?? null,
    wordTimings: wordTimings ?? null,
    order,
    isPublished: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateSubchapter(bookId, chapterId, subId, data) {
  return updateDoc(subchapterDoc(bookId, chapterId, subId), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteSubchapter(bookId, chapterId, subId) {
  return deleteDoc(subchapterDoc(bookId, chapterId, subId));
}

export async function reorderChapters(bookId, orderedIds) {
  const batch = writeBatch(db);
  orderedIds.forEach((id, index) => {
    batch.update(chapterDoc(bookId, id), { order: (index + 1) * 100, updatedAt: serverTimestamp() });
  });
  await batch.commit();
}

export async function reorderSubchapters(bookId, chapterId, orderedIds) {
  const batch = writeBatch(db);
  orderedIds.forEach((id, index) => {
    batch.update(subchapterDoc(bookId, chapterId, id), { order: (index + 1) * 100, updatedAt: serverTimestamp() });
  });
  await batch.commit();
}


