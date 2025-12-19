/**
 * Auto-generate word timings using Deepgram API
 */

const DEEPGRAM_API_KEY = import.meta.env.VITE_DEEPGRAM_API_KEY;
const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

/**
 * Generate word timings from audio using Deepgram API
 * @param {File|string} audioSource - Audio file or URL
 * @param {string} text - The text to align timings to
 * @returns {Promise<Array>} Array of word timing objects: [{word: string, start: number, end: number}]
 */
export async function generateWordTimingsWithDeepgram(audioSource, text) {
  if (!DEEPGRAM_API_KEY) {
    throw new Error('Deepgram API key not configured. Please set VITE_DEEPGRAM_API_KEY in your environment variables.');
  }

  let response;
  const apiParams = new URLSearchParams({
    model: 'nova-2',
    punctuate: 'true',
    diarize: 'false',
    smart_format: 'true',
  });

  if (audioSource instanceof File) {
    // For files, use FormData
    // Validate file before sending
    if (!audioSource.size || audioSource.size === 0) {
      throw new Error('Audio file is empty');
    }
    
    // Check if file type is supported
    const supportedTypes = ['audio/', 'video/', 'application/octet-stream'];
    const fileType = audioSource.type || '';
    const isSupported = supportedTypes.some(type => fileType.startsWith(type)) || 
                       /\.(mp3|wav|m4a|ogg|webm|flac|aac|mp4|mov|avi)$/i.test(audioSource.name);
    
    if (!isSupported && fileType) {
      console.warn(`Audio file type "${fileType}" may not be supported by Deepgram`);
    }
    
    // Verify file is readable (not corrupted)
    if (audioSource.size > 0 && audioSource.size < 100) {
      console.warn('Audio file is very small, may be corrupted');
    }
    
    const formData = new FormData();
    // Include filename to help Deepgram identify file type
    formData.append('audio', audioSource, audioSource.name || 'audio');

    // Log file info for debugging (without logging the actual file data)
    console.log('[Deepgram] Uploading audio file:', {
      name: audioSource.name,
      type: audioSource.type,
      size: audioSource.size,
      lastModified: audioSource.lastModified
    });

    response = await fetch(`${DEEPGRAM_API_URL}?${apiParams.toString()}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        // Don't set Content-Type - browser will set it with boundary for multipart/form-data
      },
      body: formData,
    });
  } else if (typeof audioSource === 'string') {
    // For URLs, pass the URL in JSON body (Deepgram fetches it server-side, avoiding CORS)
    response = await fetch(`${DEEPGRAM_API_URL}?${apiParams.toString()}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: audioSource
      }),
    });
  } else {
    throw new Error('Invalid audio source. Must be a File or URL string.');
  }

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let errorDetails = null;
    try {
      const errorData = await response.json();
      console.error('[Deepgram API Error]', errorData);
      
      if (errorData.err_msg) {
        errorMessage = errorData.err_msg;
      } else if (errorData.message) {
        errorMessage = errorData.message;
      } else if (errorData.error) {
        errorMessage = typeof errorData.error === 'string' ? errorData.error : JSON.stringify(errorData.error);
      }
      
      // Capture additional error details
      if (errorData.details) {
        errorDetails = errorData.details;
      }
    } catch (e) {
      // If JSON parsing fails, try to get text response
      try {
        const textResponse = await response.text();
        console.error('[Deepgram API Error - Text Response]', textResponse);
        if (textResponse) {
          errorMessage = `${errorMessage}: ${textResponse}`;
        }
      } catch (textErr) {
        // If text parsing also fails, use the status text
        console.error('[Deepgram API Error - Could not parse response]', e, textErr);
      }
    }
    
    const fullErrorMessage = errorDetails 
      ? `Deepgram API error: ${errorMessage} (Details: ${JSON.stringify(errorDetails)})`
      : `Deepgram API error: ${errorMessage}`;
    
    throw new Error(fullErrorMessage);
  }

  const data = await response.json();
  
  // Extract words from Deepgram response
  const deepgramWords = [];
  if (data.results && data.results.channels && data.results.channels[0] && data.results.channels[0].alternatives) {
    const alternative = data.results.channels[0].alternatives[0];
    if (alternative.words) {
      if (typeof console !== 'undefined' && console.groupCollapsed) {
        try {
          console.groupCollapsed('[Deepgram] Raw transcription');
          if (alternative.transcript) {
            console.log('Transcript:', alternative.transcript);
          }
          console.groupEnd();

          console.groupCollapsed('[Deepgram] Raw word timings');
          console.table(alternative.words.map((w, idx) => ({
            idx,
            word: w?.word,
            start: w?.start,
            end: w?.end,
            confidence: w?.confidence,
          })));
          console.groupEnd();
        } catch (err) {
          console.warn('Failed to log Deepgram transcription', err);
        }
      }

      alternative.words.forEach((w) => {
        if (!w) return;
        const word = typeof w.word === 'string' ? w.word : '';
        const start = typeof w.start === 'number' ? w.start : Number(w.start ?? 0);
        const end = typeof w.end === 'number' ? w.end : Number(w.end ?? start);
        deepgramWords.push({
          word,
          start,
          end,
          confidence: w.confidence || 1.0,
        });
      });
    }
  }

  if (deepgramWords.length === 0) {
    throw new Error('No words found in Deepgram response');
  }

  // Return Deepgram timings directly so the renderer can map them without reordering
  return deepgramWords;
}

/**
 * Align Deepgram API words to the provided text using greedy matching
 * @param {Array} deepgramWords - Words from Deepgram API: [{word: string, start: number, end: number}]
 * @param {string} text - The text to align to
 * @returns {Array} Aligned word timings: [{word: string, start: number, end: number}]
 */
function alignTimingsToText(deepgramWords, text) {
  // Normalize text: split into words, remove punctuation for matching
  const normalizeWord = (word) => word.toLowerCase().replace(/[^\w]/g, '');
  
  const textWords = text.split(/\s+/).map(w => w.trim()).filter(w => w.length > 0);
  const normalizedTextWords = textWords.map(normalizeWord);
  
  const alignedTimings = [];
  let deepgramIndex = 0;
  
  for (let i = 0; i < textWords.length; i++) {
    const textWord = textWords[i];
    const normalizedTextWord = normalizeWord(textWord);
    
    // Try to find matching word in Deepgram results
    let bestMatch = null;
    let bestMatchIndex = -1;
    
    // Look ahead up to 3 words for a match (in case of minor differences)
    for (let j = deepgramIndex; j < Math.min(deepgramIndex + 3, deepgramWords.length); j++) {
      const deepgramWord = deepgramWords[j];
      const normalizedDeepgramWord = normalizeWord(deepgramWord.word);
      
      // Exact match or contains the text word
      if (normalizedDeepgramWord === normalizedTextWord || 
          normalizedDeepgramWord.includes(normalizedTextWord) ||
          normalizedTextWord.includes(normalizedDeepgramWord)) {
        bestMatch = deepgramWord;
        bestMatchIndex = j;
        break;
      }
    }
    
    if (bestMatch) {
      // Use the matched word's timing
      alignedTimings.push({
        word: textWord, // Use the original text word (with punctuation)
        start: bestMatch.start,
        end: bestMatch.end
      });
      deepgramIndex = bestMatchIndex + 1;
    } else {
      // No match found - interpolate timing based on previous/next words
      let start, end;
      
      if (alignedTimings.length > 0) {
        // Use previous word's end time as start, estimate duration
        const prevTiming = alignedTimings[alignedTimings.length - 1];
        const avgWordDuration = deepgramWords.length > 0 
          ? deepgramWords.reduce((sum, w) => sum + (w.end - w.start), 0) / deepgramWords.length
          : 0.5; // Default 0.5 seconds per word
        start = prevTiming.end;
        end = start + avgWordDuration;
      } else if (deepgramWords.length > 0) {
        // Use first Deepgram word's start time
        start = deepgramWords[0].start;
        end = start + 0.5; // Default duration
      } else {
        // Fallback: sequential timing
        start = i * 0.5;
        end = start + 0.5;
      }
      
      alignedTimings.push({
        word: textWord,
        start: start,
        end: end
      });
    }
  }
  
  return alignedTimings;
}

