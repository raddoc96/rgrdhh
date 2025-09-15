import React, { useState } from 'react';
import { marked } from 'marked';
// Fix: Import IParagraphOptions to correctly type paragraph properties.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, Table, TableRow, TableCell, IParagraphOptions } from 'docx';
import { TeachingSectionContent, ChatMessage, GroundingSource } from '../types';
import { ArrowLeftIcon, ArrowRightIcon, DownloadIcon, LinkIcon } from './IconComponents';
import ChatSection from './ChatSection'; // This is now our FollowUpChat component

interface TeachingSectionProps {
  teachingSteps: TeachingSectionContent[];
  currentStepIndex: number;
  onNextStep: () => void;
  onPreviousStep: () => void;
  chatHistories: Record<string, ChatMessage[]>;
  onSendMessage: (sectionIndex: number, qaIndex: number, message: string, useGoogleSearch: boolean) => void;
  isChatLoading: boolean;
  activeChatKey: string | null;
  initialSources: GroundingSource[];
}

const parseInlineTokens = (tokens: any[], options: { bold?: boolean; italics?: boolean } = {}): (TextRun | ExternalHyperlink)[] => {
  const children: (TextRun | ExternalHyperlink)[] = [];
  if (!tokens) return children;

  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        children.push(...parseInlineTokens(token.tokens, { ...options, bold: true }));
        break;
      case 'em':
        children.push(...parseInlineTokens(token.tokens, { ...options, italics: true }));
        break;
      case 'link':
        children.push(new ExternalHyperlink({
          children: parseInlineTokens(token.tokens, { ...options }) as TextRun[],
          link: token.href,
        }));
        break;
      case 'text':
        children.push(new TextRun({ text: token.text, ...options }));
        break;
      default:
        if (token.text) {
          children.push(new TextRun({ text: token.text, ...options }));
        }
        break;
    }
  }
  return children;
};

// Fix: Remove HeadingLevel type annotation to resolve TS error. The type is correctly inferred.
const mapDepthToHeadingLevel = (depth: number) => {
    switch (depth) {
        case 1: return HeadingLevel.HEADING_1;
        case 2: return HeadingLevel.HEADING_2;
        case 3: return HeadingLevel.HEADING_3;
        case 4: return HeadingLevel.HEADING_4;
        case 5: return HeadingLevel.HEADING_5;
        case 6: return HeadingLevel.HEADING_6;
        default: return HeadingLevel.HEADING_1;
    }
}

const createDocxElementsFromMarkdown = (markdownText: string): (Paragraph | Table)[] => {
  if (!markdownText) return [new Paragraph({ text: '' })];

  const elements: (Paragraph | Table)[] = [];
  const tokens = marked.lexer(markdownText);

  // Fix: Refactor paragraph creation to pass options to the constructor, as Paragraph instances are immutable.
  const processListItems = (items: any[], isOrdered: boolean, level = 0): Paragraph[] => {
    const listParagraphs: Paragraph[] = [];
    items.forEach(item => {
        let isFirstParagraphInItem = true;
        item.tokens.forEach((blockToken: any) => {
            if (blockToken.type === 'text') {
                const paragraphOptions: IParagraphOptions = {
                    children: parseInlineTokens(blockToken.tokens),
                };
                if (isFirstParagraphInItem) {
                    if (isOrdered) {
                        paragraphOptions.numbering = { reference: "default-numbering", level };
                    } else {
                        paragraphOptions.bullet = { level };
                    }
                    isFirstParagraphInItem = false;
                } else {
                    paragraphOptions.indent = { left: 720 * (level + 1) };
                }
                listParagraphs.push(new Paragraph(paragraphOptions));
            } else if (blockToken.type === 'list') {
                listParagraphs.push(...processListItems(blockToken.items, blockToken.ordered, level + 1));
                isFirstParagraphInItem = false; 
            }
        });
    });
    return listParagraphs;
  };

  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        elements.push(new Paragraph({
          children: parseInlineTokens(token.tokens),
          heading: mapDepthToHeadingLevel(token.depth),
        }));
        break;
      case 'paragraph':
        elements.push(new Paragraph({
          children: parseInlineTokens(token.tokens),
        }));
        break;
      case 'list':
        elements.push(...processListItems(token.items, token.ordered));
        break;
      case 'table':
        const header = new TableRow({
          children: token.header.map((cell: any) => new TableCell({
            children: [new Paragraph({ children: parseInlineTokens(cell.tokens) })],
          })),
          tableHeader: true,
        });
        const rows = token.rows.map((row: any) => new TableRow({
          children: row.map((cell: any) => new TableCell({
            children: [new Paragraph({ children: parseInlineTokens(cell.tokens) })],
          })),
        }));
        elements.push(new Table({
          rows: [header, ...rows],
          width: { size: 100, type: 'pct' },
        }));
        break;
      case 'space':
        elements.push(new Paragraph({ text: '' }));
        break;
    }
  }

  return elements;
};

const TeachingSection: React.FC<TeachingSectionProps> = ({
  teachingSteps,
  currentStepIndex,
  onNextStep,
  onPreviousStep,
  chatHistories,
  onSendMessage,
  isChatLoading,
  activeChatKey,
  initialSources,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const currentStep = teachingSteps[currentStepIndex];
  
  const handleDownloadDocx = async () => {
    if (!teachingSteps.length) return;
    setIsDownloading(true);

    try {
      const children: (Paragraph | Table)[] = [
        new Paragraph({
            children: [new TextRun({ text: "Radiology Lesson", bold: true, size: 48 })],
            heading: HeadingLevel.TITLE,
        }),
        new Paragraph({ text: "" }), // Spacer
      ];

      teachingSteps.forEach(step => {
        children.push(new Paragraph({ text: step.section_title, heading: HeadingLevel.HEADING_1 }));
        step.qa_pairs.forEach(qa => {
          children.push(new Paragraph({ text: qa.question, heading: HeadingLevel.HEADING_2 }));
          const answerElements = createDocxElementsFromMarkdown(qa.answer);
          children.push(...answerElements);
          children.push(new Paragraph({ text: "" })); // Spacer
        });
      });

      const allSources = new Map<string, GroundingSource>();
      if (initialSources) {
          initialSources.forEach(source => {
              if (!allSources.has(source.uri)) {
                  allSources.set(source.uri, source);
              }
          });
      }
      Object.values(chatHistories).forEach(history => {
          history.forEach(message => {
              if (message.role === 'model' && message.sources) {
                  message.sources.forEach(source => {
                      if (!allSources.has(source.uri)) {
                          allSources.set(source.uri, source);
                      }
                  });
              }
          });
      });

      if (allSources.size > 0) {
          children.push(new Paragraph({ text: "" }));
          children.push(new Paragraph({ text: "Sources", heading: HeadingLevel.HEADING_1 }));
          Array.from(allSources.values()).forEach(source => {
              children.push(new Paragraph({
                  children: [
                      new TextRun({ text: `${source.title || 'Source'}: ` }),
                      new ExternalHyperlink({
                          children: [
                            new TextRun({
                                text: source.uri,
                                style: "Hyperlink",
                            }),
                          ],
                          link: source.uri,
                      }),
                  ],
                  bullet: { level: 0 },
              }));
          });
      }


      const doc = new Document({
        styles: {
            characterStyles: [
                {
                    id: 'Hyperlink',
                    name: 'Hyperlink',
                    basedOn: 'DefaultParagraphFont',
                    run: {
                        color: '0000FF',
                        underline: {
                            type: 'single',
                            color: '0000FF',
                        },
                    },
                },
            ],
        },
        numbering: {
          config: [{
            reference: "default-numbering",
            levels: [{ level: 0, format: "decimal", text: "%1." }],
          }],
        },
        sections: [{ children }],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'radiology-lesson.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error("Failed to generate DOCX", error);
    } finally {
      setIsDownloading(false);
    }
  };


  if (!currentStep) {
    return <div className="p-6 bg-slate-800 rounded-xl shadow-xl text-center text-slate-400">No teaching content available yet. Submit content to begin.</div>;
  }
  
  return (
    <div className="bg-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-slate-700/50">
      <div className="flex flex-col flex-grow p-8 md:p-12">
        <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-sky-800/50 gap-4">
            <h2 className="text-4xl font-bold text-sky-400">
              {currentStep.section_title}
            </h2>
            <button
              onClick={handleDownloadDocx}
              disabled={isDownloading}
              className="flex-shrink-0 flex items-center px-6 py-3 bg-sky-600 text-white font-bold text-base rounded-lg hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-sky-500 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
              aria-label="Download lesson as DOCX"
              title="Download entire lesson as a Word document"
            >
              {isDownloading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Downloading...
                </>
              ) : (
                <>
                  <DownloadIcon className="w-6 h-6 mr-3" />
                  Download Lesson (.docx)
                </>
              )}
            </button>
        </div>
          
        <div className="flex-grow overflow-y-auto pr-4">
            <div className="space-y-12">
              {currentStep.qa_pairs.map((qa, qaIndex) => {
                const chatKey = `${currentStepIndex}-${qaIndex}`;
                const parsedAnswer = marked.parse(qa.answer || '', { breaks: true, gfm: true });

                return (
                  <div key={qaIndex} className="p-4 border-l-4 border-slate-700">
                     <h3 className="text-2xl font-semibold text-teal-400 mb-4">
                       {qa.question}
                     </h3>
                     <div 
                        className="prose prose-invert prose-lg max-w-none prose-p:text-slate-300 prose-p:leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: parsedAnswer as string }}
                     />
                     <ChatSection 
                        chatHistory={chatHistories[chatKey] || []}
                        onSendMessage={(message, useGoogleSearch) => onSendMessage(currentStepIndex, qaIndex, message, useGoogleSearch)}
                        isChatLoading={isChatLoading && activeChatKey === chatKey}
                     />
                  </div>
                );
              })}
            </div>
        </div>
        
        {initialSources.length > 0 && (
          <div className="mt-8 pt-6 border-t border-slate-700">
            <h3 className="text-xl font-semibold text-slate-300 mb-4">Sources</h3>
            <p className="text-sm text-slate-400 mb-4">The following sources were used to generate this lesson content:</p>
            <ul className="space-y-2">
              {initialSources.map((source, index) => (
                <li key={index} className="flex items-start text-sm">
                  <LinkIcon className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0 text-sky-400" />
                  <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline break-all">
                    {source.title || source.uri}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

          <div className="flex justify-between items-center pt-6 mt-8 border-t border-slate-700">
            <button
              onClick={onPreviousStep}
              disabled={currentStepIndex === 0}
              className="flex items-center px-4 py-2 border border-slate-600 text-sm font-medium rounded-md text-slate-300 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous section"
            >
              <ArrowLeftIcon className="w-5 h-5 mr-2" />
              Previous
            </button>
            
            <span className="text-sm text-slate-500" aria-live="polite">
              Step {currentStepIndex + 1} / {teachingSteps.length}
            </span>
            
            <button
              onClick={onNextStep}
              disabled={currentStepIndex === teachingSteps.length - 1}
              className="flex items-center px-4 py-2 border border-slate-600 text-sm font-medium rounded-md text-slate-300 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Next section"
            >
              Next
              <ArrowRightIcon className="w-5 h-5 ml-2" />
            </button>
          </div>
      </div>
    </div>
  );
};

export default TeachingSection;