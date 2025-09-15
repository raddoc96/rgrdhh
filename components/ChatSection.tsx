import React, { useState, useRef, useEffect } from 'react';
import { marked } from 'marked';
import { ChatMessage } from '../types';
import { SendIcon, LinkIcon, MicrophoneIcon } from './IconComponents';
import LoadingSpinner from './LoadingSpinner';

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const isSpeechRecognitionSupported = !!SpeechRecognition;

interface ChatSectionProps {
  chatHistory: ChatMessage[];
  onSendMessage: (message: string, useGoogleSearch: boolean) => void;
  isChatLoading: boolean;
}

const formatCitations = (text: string, sources: ChatMessage['sources']): string => {
    if (!sources || sources.length === 0) {
        return text;
    }

    return text.replace(/\[(\d+)\]/g, (match, numberStr) => {
        const number = parseInt(numberStr, 10);
        if (number > 0 && number <= sources.length) {
            const source = sources[number - 1];
            return `<sup class="font-medium text-sky-400"><a href="${source.uri}" target="_blank" rel="noopener noreferrer" title="${source.title || source.uri}" class="no-underline hover:underline">[${number}]</a></sup>`;
        }
        return match; // Return original match if source not found
    });
};

const ChatSection: React.FC<ChatSectionProps> = ({ chatHistory, onSendMessage, isChatLoading }) => {
  const [inputMessage, setInputMessage] = useState<string>('');
  const [useGoogleSearch, setUseGoogleSearch] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const recognitionRef = useRef<any | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);
  
  const handleToggleListening = () => {
    if (!isSpeechRecognitionSupported) {
      alert("Speech recognition is not supported in your browser.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        setInputMessage(prev => prev + finalTranscript);
      };
      
      recognitionRef.current.onend = () => setIsListening(false);
      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim() && !isChatLoading) {
      onSendMessage(inputMessage.trim(), useGoogleSearch);
      setInputMessage('');
    }
  };

  return (
    <div className="p-4 bg-slate-800/50 rounded-xl shadow-inner mt-4 border border-slate-700/50">
      <h3 className="text-base font-semibold text-sky-400 mb-2">Ask a follow-up question</h3>
      <div ref={chatContainerRef} className="max-h-64 space-y-3 overflow-y-auto pr-2 mb-3 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-800">
        {chatHistory.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[90%] p-2.5 rounded-lg shadow ${
                msg.role === 'user'
                  ? 'bg-sky-700 text-white'
                  : 'bg-slate-700 text-slate-200'
              }`}
            >
              {msg.role === 'user' ? (
                <p className="text-sm whitespace-pre-wrap">{msg.parts.map(p => p.text).join('')}</p>
              ) : (
                <div
                  className="prose prose-sm prose-invert max-w-none prose-p:my-2 prose-headings:my-2"
                  dangerouslySetInnerHTML={{ __html: marked.parse(formatCitations(msg.parts.map(p => p.text).join('') || '', msg.sources), { breaks: true, gfm: true }) }}
                />
              )}
            </div>
            {msg.role === 'model' && msg.sources && msg.sources.length > 0 && (
              <div className="mt-2 max-w-[90%] w-full bg-slate-700/50 border border-slate-600/50 p-2 rounded-lg">
                  <h4 className="text-xs font-semibold text-slate-400 mb-1">Sources:</h4>
                  <ul className="space-y-1">
                      {msg.sources.map((source, index) => (
                          <li key={index} className="flex items-start text-xs">
                              <span className="text-sky-400 font-semibold w-6 flex-shrink-0">[{index + 1}]</span>
                              <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline break-all flex items-start">
                                  <LinkIcon className="w-3.5 h-3.5 mr-1.5 mt-0.5 flex-shrink-0" />
                                  <span>{source.title || source.uri}</span>
                              </a>
                          </li>
                      ))}
                  </ul>
              </div>
            )}
             {msg.role === 'model' && msg.relatedLinks && msg.relatedLinks.length > 0 && (
                  <div className="mt-2 max-w-[90%] w-full bg-slate-700/50 border border-slate-600/50 p-2 rounded-lg">
                      <h4 className="text-xs font-semibold text-slate-400 mb-1">Related Links:</h4>
                      <ul className="space-y-1">
                          {msg.relatedLinks.map((link, index) => (
                              <li key={index} className="flex items-start">
                                  <LinkIcon className="w-3.5 h-3.5 mr-2 mt-0.5 flex-shrink-0 text-sky-500" />
                                  <a href={link.uri} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-400 hover:underline break-all">
                                      {link.title || link.uri}
                                  </a>
                              </li>
                          ))}
                      </ul>
                  </div>
                )}
          </div>
        ))}
        {isChatLoading && (
          <div className="flex justify-start">
              <div className="max-w-[90%] p-3 rounded-lg shadow bg-slate-700 text-slate-200">
                <LoadingSpinner message="Thinking..." />
              </div>
          </div>
        )}
      </div>
      <form onSubmit={handleSendMessage} className="space-y-2">
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder={isListening ? "Listening..." : "Type your question..."}
            disabled={isChatLoading}
            className="flex-grow p-2.5 bg-slate-700 border border-slate-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-colors disabled:bg-slate-600 text-sm"
          />
          {isSpeechRecognitionSupported && (
              <button
                type="button"
                onClick={handleToggleListening}
                className={`p-2.5 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-sky-500 disabled:bg-slate-500 transition-colors ${
                    isListening ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse' : 'bg-slate-600 hover:bg-slate-500 text-slate-200'
                }`}
                aria-label={isListening ? "Stop listening" : "Start listening"}
              >
                <MicrophoneIcon className="w-5 h-5" />
              </button>
          )}
          <button
            type="submit"
            disabled={isChatLoading || !inputMessage.trim()}
            className="p-2.5 bg-sky-600 text-white rounded-md hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-sky-500 disabled:bg-slate-500 disabled:cursor-not-allowed transition-colors"
            aria-label="Send message"
          >
            <SendIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center justify-end">
            <label htmlFor="google-search-toggle" className="flex items-center cursor-pointer">
                <span className="mr-2 text-xs text-slate-400">Search web for answer</span>
                <div className="relative">
                    <input 
                        type="checkbox" 
                        id="google-search-toggle" 
                        className="sr-only" 
                        checked={useGoogleSearch}
                        onChange={() => setUseGoogleSearch(!useGoogleSearch)}
                        disabled={isChatLoading}
                    />
                    <div className={`block w-10 h-6 rounded-full transition-colors ${useGoogleSearch ? 'bg-sky-500' : 'bg-slate-600'}`}></div>
                    <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${useGoogleSearch ? 'translate-x-4' : ''}`}></div>
                </div>
            </label>
        </div>
      </form>
    </div>
  );
};

export default ChatSection;