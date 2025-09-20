import React, { useState, useCallback, useEffect } from 'react';
import { Content } from "@google/genai";
import UrlInputSection from './components/UrlInputSection';
import TeachingSection from './components/TeachingSection';
import ChatSection from './components/ChatSection';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorMessage from './components/ErrorMessage';
import { ChatMessage, TeachingSectionContent, GroundingSource } from './types';
import { getTeachingSections, getFollowUpResponse, MissingPdfError } from './services/geminiService';
import { UploadIcon } from './components/IconComponents';

// Helper to convert File to Base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = error => reject(error);
  });
};

const App: React.FC = () => {
  const [teachingSteps, setTeachingSteps] = useState<TeachingSectionContent[]>([]);
  const [initialSources, setInitialSources] = useState<GroundingSource[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [chatHistories, setChatHistories] = useState<Record<string, ChatMessage[]>>({});
  const [isLoadingContent, setIsLoadingContent] = useState<boolean>(false);
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const [activeChatKey, setActiveChatKey] = useState<string | null>(null);
  const [error, setError] = useState<string>('');
  // Fix: Update default model to gemini-2.5-flash as per guidelines.
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-pro');

  const [lastLearningContext, setLastLearningContext] = useState<any>(null);
  const [requestedPdfs, setRequestedPdfs] = useState<string[]>([]);
  
  // New states for flexible supplemental content submission
  const [supplementalContent, setSupplementalContent] = useState<Record<string, { file?: File; text?: string; name: string }>>({});
  const [supplementalBulkPdfs, setSupplementalBulkPdfs] = useState<File[]>([]);
  const [pastingForUrl, setPastingForUrl] = useState<string | null>(null);
  const [currentPastedText, setCurrentPastedText] = useState<string>('');
  
  useEffect(() => {
    if (!process.env.API_KEY) {
      setError("Gemini API Key (API_KEY environment variable) is not configured. The application will not function correctly.");
    }
  }, []);

  const handleStartLearning = useCallback(async (context: { urls: string[]; pdfFiles: File[]; pastedTexts?: string[]; searchQuery: string; focusTopic: string; model: string; }) => {
    if (!process.env.API_KEY) {
      setError("Gemini API Key is missing. Please configure the API_KEY environment variable.");
      return;
    }
    setIsLoadingContent(true);
    setError('');
    setTeachingSteps([]);
    setInitialSources([]);
    setChatHistories({});
    setCurrentStepIndex(0);
    setSelectedModel(context.model);
    setRequestedPdfs([]);
    setLastLearningContext(context);
    
    try {
      let pdfPayloads: { base64: string; mimeType: string; }[] = [];
      if (context.pdfFiles.length > 0) {
        pdfPayloads = await Promise.all(context.pdfFiles.map(async (file) => ({
          base64: await fileToBase64(file),
          mimeType: file.type,
        })));
      }
      
      const { sections, sources } = await getTeachingSections({ 
        urls: context.urls, 
        pdfs: pdfPayloads, 
        pastedTexts: context.pastedTexts,
        searchQuery: context.searchQuery, 
        focusTopic: context.focusTopic,
        model: context.model,
      });
      setTeachingSteps(sections);
      setInitialSources(sources);
      setLastLearningContext(null);
    } catch (err) {
      console.error(err);
      if (err instanceof MissingPdfError) {
        setError(err.message);
        setRequestedPdfs(err.urls);
        setTeachingSteps([]);
      } else {
        setError(err instanceof Error ? err.message : "An unknown error occurred while fetching teaching content.");
        setTeachingSteps([]);
        setLastLearningContext(null);
      }
    } finally {
      setIsLoadingContent(false);
    }
  }, []);

  const handleNextStep = () => {
    if (currentStepIndex < teachingSteps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    }
  };

  const handlePreviousStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  };

  const handleSendFollowUpMessage = useCallback(async (
    sectionIndex: number, 
    qaIndex: number, 
    message: string, 
    useGoogleSearch: boolean
  ) => {
    if (!process.env.API_KEY) {
      setError("Gemini API Key is missing.");
      return;
    }

    const chatKey = `${sectionIndex}-${qaIndex}`;
    const currentHistory = chatHistories[chatKey] || [];
    const currentTeachingSection = teachingSteps[sectionIndex];
    const currentQA = currentTeachingSection?.qa_pairs[qaIndex];

    if (!currentTeachingSection || !currentQA) {
        setError("Cannot send message, the teaching context is missing.");
        return;
    }

    setIsChatLoading(true);
    setActiveChatKey(chatKey);
    setError('');

    const newUserMessage: ChatMessage = { 
      id: Date.now().toString(), 
      role: 'user', 
      parts: [{ text: message }] 
    };

    const updatedHistory = [...currentHistory, newUserMessage];
    setChatHistories(prev => ({ ...prev, [chatKey]: updatedHistory }));

    const apiHistory: Content[] = updatedHistory.map(msg => ({role: msg.role, parts: msg.parts}));
    
    try {
        const fullSectionContent = currentTeachingSection.qa_pairs.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join('\n\n');

        const botResponse = await getFollowUpResponse(
            message,
            { 
                originalQuestion: currentQA.question, 
                originalAnswer: currentQA.answer,
                fullSectionContent: fullSectionContent
            },
            useGoogleSearch,
            apiHistory,
            selectedModel,
        );

        const newBotMessage: ChatMessage = { 
            id: (Date.now() + 1).toString(), 
            role: 'model', 
            parts: [{ text: botResponse.text }],
            sources: botResponse.sources,
            relatedLinks: botResponse.relatedLinks,
        };

        setChatHistories(prev => ({
            ...prev,
            [chatKey]: [...updatedHistory, newBotMessage]
        }));

    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred in chat.";
      setError(`Chat Error: ${errorMessage}`);
      const errorBotMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        parts: [{ text: `Sorry, I encountered an error: ${errorMessage}` }]
      };
       setChatHistories(prev => ({
            ...prev,
            [chatKey]: [...updatedHistory, errorBotMessage]
        }));
    } finally {
      setIsChatLoading(false);
      setActiveChatKey(null);
    }
  }, [chatHistories, teachingSteps, selectedModel]);
  
  const handlePdfSubmission = useCallback(() => {
    if (!lastLearningContext) {
      setError("Cannot re-submit, original context was lost.");
      return;
    }
    const hasIndividualContent = Object.keys(supplementalContent).length > 0;
    const hasBulkContent = supplementalBulkPdfs.length > 0;

    if (!hasIndividualContent && !hasBulkContent) {
      setError("Please provide content for at least one of the requested PDFs.");
      return;
    }

    const allSupplementalPdfs = [
      ...supplementalBulkPdfs,
      ...Object.values(supplementalContent).map(c => c.file).filter((f): f is File => !!f)
    ];

    const allPastedTexts = Object.values(supplementalContent)
      .map(c => c.text)
      .filter((t): t is string => !!t);

    const newContext = {
      ...lastLearningContext,
      pdfFiles: [...(lastLearningContext.pdfFiles || []), ...allSupplementalPdfs],
      pastedTexts: allPastedTexts,
    };

    setSupplementalContent({});
    setSupplementalBulkPdfs([]);
    setPastingForUrl(null);
    setCurrentPastedText('');
    handleStartLearning(newContext);
  }, [lastLearningContext, supplementalContent, supplementalBulkPdfs, handleStartLearning]);
  
  const handleIndividualFileUpload = (event: React.ChangeEvent<HTMLInputElement>, url: string) => {
    const file = event.target.files?.[0];
    if (file) {
      setSupplementalContent(prev => ({ ...prev, [url]: { file, name: file.name } }));
    }
  };

  const handleSavePastedText = (url: string) => {
    if (currentPastedText.trim()) {
      setSupplementalContent(prev => ({
        ...prev,
        [url]: { text: currentPastedText, name: `Pasted content for ${url.substring(0, 30)}...` }
      }));
    }
    setPastingForUrl(null);
    setCurrentPastedText('');
  };

  const clearError = () => setError('');
  
  const hasSupplementalContent = Object.keys(supplementalContent).length > 0 || supplementalBulkPdfs.length > 0;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto">
      <UrlInputSection 
        onStartLearning={handleStartLearning} 
        isLoading={isLoadingContent} 
      />

      {error && <ErrorMessage message={error} onClear={clearError}/>}
      
      {requestedPdfs.length > 0 && !isLoadingContent && (
        <div className="p-6 bg-slate-800 rounded-xl shadow-2xl space-y-4 ring-1 ring-amber-500/50">
          <h2 className="text-xl font-semibold text-amber-400">Additional Information Required</h2>
          <p className="text-slate-300">The AI requires the content of the following PDFs. For each, you can upload the file or paste its text content.</p>
          
          <div className="space-y-4 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
            {requestedPdfs.map((url, index) => (
              <div key={index} className="p-3 bg-slate-700/50 rounded-lg border border-slate-600/50">
                <div className="flex justify-between items-start gap-4">
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline text-sm break-all">{url}</a>
                  {supplementalContent[url] && (
                    <span className="text-xs text-green-400 bg-green-900/50 px-2 py-1 rounded-full whitespace-nowrap">
                      {supplementalContent[url].file ? `File Added` : 'Text Added'}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <label className="flex-1 text-center px-3 py-1.5 text-xs font-medium rounded-md text-slate-200 bg-slate-600 hover:bg-slate-500 cursor-pointer transition-colors">
                    Upload PDF
                    <input type="file" accept=".pdf" onChange={(e) => handleIndividualFileUpload(e, url)} className="hidden" />
                  </label>
                  <button 
                    onClick={() => {
                      const isPasting = pastingForUrl === url;
                      setPastingForUrl(isPasting ? null : url);
                      setCurrentPastedText(isPasting ? '' : (supplementalContent[url]?.text || ''));
                    }}
                    className={`flex-1 text-center px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${pastingForUrl === url ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-slate-600 hover:bg-slate-500 text-slate-200'}`}
                  >
                    {pastingForUrl === url ? 'Cancel Paste' : 'Paste Text'}
                  </button>
                </div>
                {pastingForUrl === url && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      placeholder={`Paste content for ${url} here...`}
                      className="w-full h-24 p-2 bg-slate-900 border border-slate-600 rounded-md text-sm focus:ring-2 focus:ring-sky-500 outline-none"
                      value={currentPastedText}
                      onChange={(e) => setCurrentPastedText(e.target.value)}
                    />
                    <button 
                      onClick={() => handleSavePastedText(url)}
                      className="w-full px-3 py-1.5 text-xs font-medium rounded-md text-white bg-sky-600 hover:bg-sky-700 disabled:bg-slate-500"
                      disabled={!currentPastedText.trim()}
                    >
                      Save Text
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-slate-700/50">
            <p className="text-sm text-slate-400 mb-2">Or, upload all required PDFs in bulk:</p>
            <label htmlFor="pdf-bulk-resubmission" className="flex items-center justify-center w-full p-4 bg-slate-700 border-2 border-dashed border-slate-600 rounded-md cursor-pointer hover:bg-slate-600 hover:border-sky-500 transition-colors">
              <UploadIcon className="w-6 h-6 text-slate-400 mr-3"/>
              <span className="text-slate-300">{supplementalBulkPdfs.length > 0 ? `${supplementalBulkPdfs.length} file(s) selected for bulk upload` : 'Click to select PDF(s) for bulk upload'}</span>
            </label>
            <input
              type="file" id="pdf-bulk-resubmission" accept=".pdf" multiple
              onChange={(e) => setSupplementalBulkPdfs(e.target.files ? Array.from(e.target.files) : [])}
              className="hidden"
            />
          </div>

          <button
            onClick={handlePdfSubmission}
            disabled={!hasSupplementalContent}
            className="w-full flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-sky-500 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
          >
            Submit Content and Continue
          </button>
        </div>
      )}

      {isLoadingContent && <LoadingSpinner message="Analyzing content and generating teaching material..." />}

      {teachingSteps.length > 0 && !isLoadingContent && (
        <TeachingSection
            teachingSteps={teachingSteps}
            currentStepIndex={currentStepIndex}
            onNextStep={handleNextStep}
            onPreviousStep={handlePreviousStep}
            chatHistories={chatHistories}
            onSendMessage={handleSendFollowUpMessage}
            isChatLoading={isChatLoading}
            activeChatKey={activeChatKey}
            initialSources={initialSources}
        />
      )}
      {!isLoadingContent && teachingSteps.length === 0 && requestedPdfs.length === 0 && !error && (
         <div className="text-center py-10 text-slate-500">
            <p>Enter a URL, upload a PDF, or perform a Google Search, then click "Start Learning" to begin.</p>
         </div>
      )}
       <footer className="text-center text-xs text-slate-600 mt-auto py-4">
        Powered by Gemini API. For educational purposes.
      </footer>
    </div>
  );
};

export default App;