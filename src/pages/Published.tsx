import React, { useEffect, useState } from 'react';
import { 
  CheckCircle, 
  Video, 
  FileText, 
  ExternalLink, 
  Copy, 
  Hash,
  Eye
} from 'lucide-react';
import { api } from '../lib/api';
import { PublishedItem } from '../types';
import { Card, Button, Badge } from '../components/ui';
import { formatDate, cn } from '../lib/utils';

export default function Published() {
  const [items, setItems] = useState<PublishedItem[]>([]);
  const [activeTab, setActiveTab] = useState<'video' | 'post'>('video');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await api.getPublished();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = Array.isArray(items) ? items.filter(item => item.type === activeTab) : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Published Content</h1>
        <p className="text-slate-500">Review and manage your successfully posted AI content.</p>
      </div>

      <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl w-fit">
        <button 
          onClick={() => setActiveTab('video')}
          className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-semibold transition-all",
            activeTab === 'video' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
          )}
        >
          <Video className="w-4 h-4" />
          Published Videos
        </button>
        <button 
          onClick={() => setActiveTab('post')}
          className={cn(
            "flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-semibold transition-all",
            activeTab === 'post' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-600 hover:text-slate-900"
          )}
        >
          <FileText className="w-4 h-4" />
          Published Posts
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {loading ? (
          [1,2,3].map(i => <div key={i} className="h-64 bg-slate-100 animate-pulse rounded-xl"></div>)
        ) : filteredItems.length === 0 ? (
          <div className="col-span-full py-20 text-center">
            <CheckCircle className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-500 font-medium">No published {activeTab}s yet.</p>
          </div>
        ) : (
          filteredItems.map((item) => (
            <Card key={item.id} className="group">
              <div className="relative aspect-video bg-slate-100 overflow-hidden">
                <img 
                  src={item.thumbnail} 
                  alt={item.title} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                  <Button variant="secondary" size="sm" className="w-full bg-white/20 backdrop-blur-md text-white border-white/20 hover:bg-white/30">
                    <Eye className="w-4 h-4 mr-2" />
                    Preview Content
                  </Button>
                </div>
                <div className="absolute top-3 right-3">
                  <Badge variant="success">Published</Badge>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <h3 className="font-bold text-slate-900 line-clamp-1">{item.title}</h3>
                  <p className="text-xs text-slate-500 mt-1">{formatDate(item.postedAt)}</p>
                </div>
                
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Niche</p>
                  <p className="text-sm text-slate-700 font-medium">{item.niche}</p>
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => navigator.clipboard.writeText(item.caption)}>
                    <Copy className="w-3.5 h-3.5 mr-2" />
                    Caption
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => navigator.clipboard.writeText(item.hashtags)}>
                    <Hash className="w-3.5 h-3.5 mr-2" />
                    Hashtags
                  </Button>
                </div>

                <Button variant="primary" className="w-full" onClick={() => window.open(item.facebookUrl, '_blank')}>
                  Open on Facebook
                  <ExternalLink className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
