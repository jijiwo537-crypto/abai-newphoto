
import React from 'react';
import { Icon } from './Icon';
import { processImageFile } from '../utils/imageLoader';

interface GalleryOverlayProps {
  photos: string[];
  onClose: () => void;
  onDelete: (index: number) => void;
  onImport: (srcs: string[]) => void;
  onEdit: (src: string, index: number) => void;
}

const RAW_ACCEPT = "image/*,.heic,.heif,.dng,.cr2,.nef,.arw,.orf,.rw2,.raf,.srw";

export const GalleryOverlay: React.FC<GalleryOverlayProps> = ({ photos, onClose, onDelete, onImport, onEdit }) => {
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const promises = Array.from(files).map(async (file: File) => {
        try {
          const objectUrl = await processImageFile(file);
          return new Promise<string>((resolve) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
              } else {
                resolve('');
              }
              URL.revokeObjectURL(objectUrl);
            };
            img.onerror = () => {
              URL.revokeObjectURL(objectUrl);
              resolve('');
            };
            img.src = objectUrl;
          });
        } catch (err) {
          console.error("Failed to process image:", err);
          return '';
        }
      });

      const results = await Promise.all(promises);
      const validResults = results.filter(src => src.length > 0);
      
      if (validResults.length > 0) {
        onImport(validResults);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col animate-in fade-in slide-in-from-bottom duration-300">
      <header className="p-4 flex justify-between items-center border-b border-white/10">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors">
            <Icon name="arrow_back" className="text-2xl" />
          </button>
          <h2 className="text-lg font-medium tracking-tight">相簿 ({photos.length})</h2>
        </div>
        <div className="w-8"></div>
      </header>
      
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        {photos.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-40">
            <Icon name="no_photography" className="text-6xl mb-4" />
            <p>尚未拍攝或導入任何照片</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((src, idx) => (
              <div key={idx} className="relative aspect-square group">
                <img 
                  src={src} 
                  className="w-full h-full object-cover rounded-lg cursor-pointer active:scale-95 transition-transform" 
                  alt={`Capture ${idx}`}
                  onClick={() => onEdit(src, idx)}
                />
                <button 
                  onClick={(e) => { e.stopPropagation(); onDelete(idx); }}
                  className="absolute top-1 right-1 bg-black/60 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Icon name="delete" className="text-sm text-red-400" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <label className="absolute bottom-8 right-6 w-14 h-14 rounded-full border border-white/20 bg-white/10 backdrop-blur-xl flex items-center justify-center cursor-pointer active:scale-90 transition-all hover:bg-white/20 shadow-2xl z-50">
        <Icon name="add" className="text-3xl text-white" />
        <input type="file" accept={RAW_ACCEPT} multiple className="hidden" onChange={handleFileChange} />
      </label>
    </div>
  );
};
