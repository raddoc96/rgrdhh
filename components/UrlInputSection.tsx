import React, { useState, useCallback, useRef } from 'react';
import { AcademicCapIcon, UploadIcon, MicrophoneIcon } from './IconComponents';

interface UrlInputSectionProps {
  onStartLearning: (context: { urls: string[]; pdfFiles: File[]; searchQuery: string; focusTopic: string; model: string; }) => void;
  isLoading: boolean;
}

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const isSpeechRecognitionSupported = !!SpeechRecognition;

const UrlInputSection: React.FC<UrlInputSectionProps> = ({ onStartLearning, isLoading }) => {
  const [sources, setSources] = useState({ url: true, pdf: false, search: false });
  const [urls, setUrls] = useState<string[]>(['']);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [focusTopic, setFocusTopic] = useState<string>('');
  const [model, setModel] = useState<string>('gemini-2.5-pro');
  const [inputError, setInputError] = useState<string>('');
  const [listeningField, setListeningField] = useState<null | 'search' | 'focus'>(null);
  const recognitionRef = useRef<any | null>(null);

  const isValidUrl = (urlString: string): boolean => {
    if (!urlString) return false;
    try {
      new URL(urlString);
      return true;
    } catch (e) {
      return false;
    }
  };
  
  const handleUrlChange = (index: number, value: string) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
    if (inputError) setInputError('');
  };

  const addUrlInput = () => {
    setUrls([...urls, '']);
  };

  const removeUrlInput = (index: number) => {
    const newUrls = urls.filter((_, i) => i !== index);
    setUrls(newUrls);
  };
  
  const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      setPdfFiles(prevFiles => [...prevFiles, ...files]);
      if (inputError) setInputError('');
    }
  };

  const handleRemovePdf = (indexToRemove: number) => {
    setPdfFiles(prevFiles => prevFiles.filter((_, index) => index !== indexToRemove));
  };


  const handleSourceToggle = (source: keyof typeof sources) => {
    setSources(prev => ({ ...prev, [source]: !prev[source] }));
    setInputError('');
  };

  const handleToggleListening = (field: 'search' | 'focus') => {
    if (!isSpeechRecognitionSupported) {
      alert("Speech recognition is not supported in your browser.");
      return;
    }

    if (listeningField === field) {
      recognitionRef.current?.stop();
      return;
    }

    if (recognitionRef.current) {
        recognitionRef.current.stop();
    }
    
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          if (field === 'search') {
            setSearchQuery(prev => (prev ? prev.trim() + ' ' : '') + finalTranscript);
          } else if (field === 'focus') {
            setFocusTopic(prev => (prev ? prev.trim() + ' ' : '') + finalTranscript);
          }
        }
    };
    
    recognition.onend = () => {
        setListeningField(null);
        recognitionRef.current = null;
    };
    
    recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setListeningField(null);
        recognitionRef.current = null;
    };

    recognition.start();
    setListeningField(field);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setInputError('');

    const { url: useUrl, pdf: usePdf, search: useSearch } = sources;

    if (!useUrl && !usePdf && !useSearch) {
      setInputError("Please select at least one content source to merge.");
      return;
    }
    
    const filteredUrls = urls.map(u => u.trim()).filter(Boolean);

    let hasError = false;
    if (useUrl) {
      if (filteredUrls.length === 0) {
        setInputError("Please enter at least one webpage URL.");
        hasError = true;
      } else if (filteredUrls.some(u => !isValidUrl(u))) {
        setInputError("Please ensure all entered URLs are valid (e.g., https://example.com).");
        hasError = true;
      }
    }
    if (usePdf && pdfFiles.length === 0) {
      setInputError("Please upload at least one PDF file.");
      hasError = true;
    }
    if (useSearch && !searchQuery.trim()) {
      setInputError("Please enter a search query.");
      hasError = true;
    }

    if (hasError) return;

    onStartLearning({
      urls: useUrl ? filteredUrls : [],
      pdfFiles: usePdf ? pdfFiles : [],
      searchQuery: useSearch ? searchQuery : '',
      focusTopic,
      model,
    });
  };
  
  const isSubmitDisabled = isLoading ||
    (!sources.url && !sources.pdf && !sources.search) ||
    (sources.url && urls.every(u => !u.trim())) ||
    (sources.pdf && pdfFiles.length === 0) ||
    (sources.search && !searchQuery.trim());

  return (
    <form onSubmit={handleSubmit} className="p-6 bg-slate-800 rounded-xl shadow-2xl space-y-6">
      <div className="flex items-center space-x-3 text-2xl font-semibold text-sky-400">
         <AcademicCapIcon className="w-8 h-8" />
         <h1>Answer generation for Radiology questions</h1>
      </div>
      <p className="text-sm text-slate-400">
        Select one or more sources to merge into a single, interactive lesson.
      </p>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Merge Content Sources
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 rounded-md shadow-sm bg-slate-700 p-1 gap-1">
          {(['url', 'pdf', 'search'] as const).map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => handleSourceToggle(source)}
              className={`w-full px-4 py-2 text-sm font-medium capitalize rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-800 ${
                sources[source] ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-600'
              }`}
            >
              {source === 'search' ? 'Google Search' : source}
            </button>
          ))}
        </div>
      </div>
      
      <div className="space-y-4">
        {sources.url && (
          <div>
            <label htmlFor="url-0" className="block text-sm font-medium text-slate-300 mb-1">
              Webpage URLs <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              {urls.map((url, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <input
                    type="url"
                    id={`url-${index}`}
                    value={url}
                    onChange={(e) => handleUrlChange(index, e.target.value)}
                    placeholder="https://example.com/article"
                    className="w-full p-3 bg-slate-700 border border-slate-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-colors"
                  />
                  {urls.length > 1 && (
                    <button type="button" onClick={() => removeUrlInput(index)} className="p-2 text-slate-400 hover:text-red-400 transition-colors" aria-label={`Remove URL ${index + 1}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" /></svg>
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={addUrlInput} className="text-sm text-sky-400 hover:text-sky-300 transition-colors font-medium">
                + Add another URL
              </button>
            </div>
          </div>
        )}
        
        {sources.pdf && (
          <div>
            <label htmlFor="pdf" className="block text-sm font-medium text-slate-300 mb-1">
              PDF Documents <span className="text-red-500">*</span>
            </label>
            <label htmlFor="pdf-upload" className="flex items-center justify-center w-full p-3 bg-slate-700 border-2 border-dashed border-slate-600 rounded-md cursor-pointer hover:bg-slate-600 hover:border-sky-500 transition-colors">
              <UploadIcon className="w-6 h-6 text-slate-400 mr-3"/>
              <span className="text-slate-300">{pdfFiles.length > 0 ? `${pdfFiles.length} file(s) selected` : 'Click to upload PDFs'}</span>
            </label>
            <input
              type="file"
              id="pdf-upload"
              accept=".pdf"
              multiple
              onChange={handlePdfChange}
              className="hidden"
            />
             {pdfFiles.length > 0 && (
              <div className="mt-2 space-y-1 max-h-32 overflow-y-auto pr-2">
                {pdfFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex justify-between items-center text-sm p-2 bg-slate-700/50 rounded">
                    <span className="text-slate-300 truncate" title={file.name}>{file.name}</span>
                    <button type="button" onClick={() => handleRemovePdf(index)} className="ml-2 p-1 text-slate-400 hover:text-red-400 transition-colors flex-shrink-0" aria-label={`Remove ${file.name}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {sources.search && (
          <div>
            <label htmlFor="search-query" className="block text-sm font-medium text-slate-300 mb-1">
              Radiology Search Query <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <textarea
                id="search-query"
                value={searchQuery}
                onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (inputError) setInputError('');
                }}
                placeholder="e.g., 'latest advancements in pediatric neuroimaging'"
                rows={3}
                className="w-full p-3 bg-slate-700 border border-slate-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-colors pr-12"
              />
              {isSpeechRecognitionSupported && (
                <button
                  type="button"
                  onClick={() => handleToggleListening('search')}
                  className={`absolute top-1/2 -translate-y-1/2 right-3 p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-700 focus:ring-sky-500 transition-colors ${
                      listeningField === 'search' ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse' : 'bg-slate-600 hover:bg-slate-500 text-slate-200'
                  }`}
                  aria-label={listeningField === 'search' ? "Stop listening" : "Start listening for search query"}
                >
                  <MicrophoneIcon className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        )}

         <div>
            <label htmlFor="focus-topic" className="block text-sm font-medium text-slate-300 mb-1">
              Focus on a specific question/ topic (optional)
            </label>
             <div className="relative">
              <textarea
                id="focus-topic"
                value={focusTopic}
                onChange={(e) => setFocusTopic(e.target.value)}
                placeholder="e.g., 'diagnostic criteria' or 'summarize treatment options'"
                rows={2}
                className="w-full p-3 bg-slate-700 border border-slate-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-colors pr-12"
              />
              {isSpeechRecognitionSupported && (
                  <button
                    type="button"
                    onClick={() => handleToggleListening('focus')}
                    className={`absolute top-1/2 -translate-y-1/2 right-3 p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-700 focus:ring-sky-500 transition-colors ${
                        listeningField === 'focus' ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse' : 'bg-slate-600 hover:bg-slate-500 text-slate-200'
                    }`}
                    aria-label={listeningField === 'focus' ? "Stop listening" : "Start listening for focus topic"}
                  >
                    <MicrophoneIcon className="w-5 h-5" />
                  </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">The AI will concentrate on this topic when generating the lesson.</p>
          </div>
          <div>
            <label htmlFor="model" className="block text-sm font-medium text-slate-300 mb-1">
              Select AI Model
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full p-3 bg-slate-700 border border-slate-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none transition-colors"
            >
              <option value="gemini-2.5-pro">Gemini 2.5 Pro (Default)</option>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
            </select>
          </div>
      </div>

      {inputError && <p id="input-error" className="mt-2 text-sm text-red-400">{inputError}</p>}

      <button
        type="submit"
        disabled={isSubmitDisabled}
        className="w-full flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-sky-500 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
      >
        {isLoading ? 'Processing Content...' : 'Start Learning'}
      </button>
    </form>
  );
};

export default UrlInputSection;