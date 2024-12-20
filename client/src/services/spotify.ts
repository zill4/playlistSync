declare global {
    interface Window {
        spotifyCallback: (code: string) => Promise<void>;
    }
}

import { ResponseHandler } from "./responseHandler";
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../firebase';
import { SpotifyPlaylist } from "../models/SpotifyPlaylist";
import type { GenericTrack } from "../models/Playlist";

export class SpotifyService {
    private static baseUrl = 'https://api.spotify.com/v1';
    private static functions = getFunctions();
    private static clientId = import.meta.env.PUBLIC_SPOTIFY_CLIENT_ID;
    private static redirectUri = typeof window !== 'undefined' 
        ? `${window.location.origin}/spotify` 
        : '';
    
        static async authorize(): Promise<void> {
            if (typeof window === 'undefined') return;
    
            const scope = [
                'playlist-modify-private',
                'playlist-modify-public',
                'user-read-private',
                'user-read-email'
            ].join(' ');
    
            const params = new URLSearchParams({
                response_type: 'code',
                client_id: this.clientId,
                scope,
                redirect_uri: this.redirectUri,
                state: crypto.randomUUID()
            });
            const authUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;
        
            return new Promise((resolve, reject) => {
                // Open popup
                const popup = window.open(
                    authUrl,
                    'Spotify Login',
                    'width=500,height=700,left=200,top=100'
                );
    
                // Handle popup closed
                const popupTimer = setInterval(() => {
                    if (popup?.closed) {
                        clearInterval(popupTimer);
                        reject(new Error('Authentication cancelled'));
                    }
                }, 1000);
    
                // Handle auth callback
                window.spotifyCallback = async (code: string) => {
                    if (popup) popup.close();
                    clearInterval(popupTimer);
    
                    try {
                        const functions = getFunctions();
                        const exchangeSpotifyCode = httpsCallable(functions, 'exchangeSpotifyCode');
                        
                        const result = await exchangeSpotifyCode({ 
                            code,
                            redirectUri: this.redirectUri
                        });
                        
                        const { access_token, refresh_token, expires_in } = result.data as any;
    
                        localStorage.setItem('spotify_access_token', access_token);
                        localStorage.setItem('spotify_refresh_token', refresh_token);
                        localStorage.setItem('spotify_token_expiry', 
                            (Date.now() + (expires_in * 1000)).toString()
                        );
    
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };
            });
        }
    
    private static async getAccessToken(): Promise<string> {
        // Try to get token from localStorage first
        const storedToken = localStorage.getItem('spotify_access_token');
        const tokenExpiry = localStorage.getItem('spotify_token_expiry');
        
        // Check if token exists and is not expired
        if (storedToken && tokenExpiry && Date.now() < parseInt(tokenExpiry)) {
            return storedToken;
        }

        // If no valid token, check if we have a refresh token
        const refreshToken = localStorage.getItem('spotify_refresh_token');
        if (refreshToken) {
            return await this.refreshAccessToken();
        }

        // If no refresh token, need to re-authorize
        this.authorize();
        throw new Error('Authorization required');
    }
    
    private static async refreshAccessToken(): Promise<string> {
        try {
            const getSpotifyToken = httpsCallable(this.functions, 'getSpotifyToken');
            const result = await getSpotifyToken();
            
            const { access_token, expires_in } = result.data as any;
            
            // Store the new token and its expiry time
            localStorage.setItem('spotify_access_token', access_token);
            localStorage.setItem('spotify_token_expiry', 
                (Date.now() + (expires_in * 1000)).toString()
            );
            
            return access_token;
        } catch (error) {
            console.error('Error refreshing token:', error);
            throw error;
        }
    }
  
    static async getPlaylist(id: string): Promise<SpotifyPlaylist> {
        // Try public access first with client credentials token
        try {
            const getSpotifyToken = httpsCallable(this.functions, 'getSpotifyToken');
            const result = await getSpotifyToken();
            const { access_token } = result.data as any;

            // Try playlist endpoint first
            const response = await fetch(`${this.baseUrl}/playlists/${id}`, {
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                return new SpotifyPlaylist(data);
            }

            // If not found, try album endpoint
            const albumResponse = await fetch(`${this.baseUrl}/albums/${id}`, {
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (albumResponse.ok) {
                const albumData = await albumResponse.json();
                const playlistData = {
                    id: albumData.id,
                    name: albumData.name,
                    description: `Album by ${albumData.artists[0].name}`,
                    images: albumData.images,
                    tracks: {
                        items: albumData.tracks.items.map((track: any) => ({
                            track: {
                                ...track,
                                album: albumData
                            }
                        })),
                        total: albumData.tracks.total
                    },
                    uri: albumData.uri
                };
                return new SpotifyPlaylist(playlistData);
            }

            // If we get a 401, try user auth
            if (response.status === 401 || albumResponse.status === 401) {
                return this.getPlaylistWithUserAuth(id);
            }

            throw new Error('Resource not found');
        } catch (error) {
            console.error('Failed to fetch playlist/album:', error);
            throw error;
        }
    }

    private static async getPlaylistWithUserAuth(id: string): Promise<SpotifyPlaylist> {
        return ResponseHandler.retryWithNewToken(
            async (token: string) => {
                // Try playlist endpoint first
                const playlistResponse = await fetch(`${this.baseUrl}/playlists/${id}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (playlistResponse.ok) {
                    const data = await playlistResponse.json();
                    return new SpotifyPlaylist(data);
                }

                // If not found, try album endpoint
                const albumResponse = await fetch(`${this.baseUrl}/albums/${id}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!albumResponse.ok) {
                    throw new Error('Failed to fetch playlist or album');
                }

                const albumData = await albumResponse.json();
                const playlistData = {
                    id: albumData.id,
                    name: albumData.name,
                    description: `Album by ${albumData.artists[0].name}`,
                    images: albumData.images,
                    tracks: {
                        items: albumData.tracks.items.map((track: any) => ({
                            track: {
                                ...track,
                                album: albumData
                            }
                        })),
                        total: albumData.tracks.total
                    },
                    uri: albumData.uri
                };

                return new SpotifyPlaylist(playlistData);
            },
            async () => await this.getAccessToken()
        );
    }

    static async createPlaylist(name: string, description?: string): Promise<string> {
        const userId = await this.getCurrentUserId();
        // Truncate description to 300 characters if it exists
        const truncatedDescription = description && description.length > 300 
            ? description.substring(0, 297) + '...'
            : description;
        
        return ResponseHandler.retryWithNewToken(
            async (token: string) => {
                const response = await fetch(`${this.baseUrl}/users/${userId}/playlists`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name,
                        description: truncatedDescription,
                        public: false
                    })
                });

                if (!response.ok) {
                    const errorData = await response.text();
                    console.error('Playlist creation failed:', errorData);
                    throw new Error('Failed to create playlist');
                }

                const data = await response.json();
                return data.id;
            },
            async () => await this.getAccessToken()
        );
    }

    static async searchTrack(track: GenericTrack): Promise<string | null> {
        return ResponseHandler.retryWithNewToken(
            async (token: string) => {
                const query = encodeURIComponent(`track:${track.name} artist:${track.artists[0].name}`);
                const response = await fetch(
                    `${this.baseUrl}/search?q=${query}&type=track&limit=1`,
                    {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                if (!response.ok) {
                    throw new Error('Failed to search track');
                }

                const data = await response.json();
                if (data.tracks?.items?.[0]) {
                    return data.tracks.items[0].uri;
                }
                return null;
            },
            async () => await this.getAccessToken()
        );
    }

    static async addTracksToPlaylist(
        playlistId: string, 
        tracks: GenericTrack[],
        onProgress?: (status: string, progress: number, phase: 'searching' | 'adding', currentTrack?: GenericTrack) => void
    ): Promise<void> {
        const foundTracks: string[] = [];
        const notFoundTracks: GenericTrack[] = [];

        // First, find all matching tracks
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            onProgress?.(
                `Searching for "${track.name}" by ${track.artists[0].name}...`,
                (i / tracks.length) * 50,
                'searching',
                track
            );

            const trackUri = await this.searchTrack(track);
            if (trackUri) {
                foundTracks.push(trackUri);
            } else {
                notFoundTracks.push(track);
            }
        }

        // Add tracks in batches of 100 (Spotify's limit)
        const BATCH_SIZE = 100;
        for (let i = 0; i < foundTracks.length; i += BATCH_SIZE) {
            const batch = foundTracks.slice(i, i + BATCH_SIZE);
            const progress = 50 + ((i / foundTracks.length) * 50);
            
            onProgress?.(
                `Adding tracks ${i + 1}-${Math.min(i + BATCH_SIZE, foundTracks.length)} of ${foundTracks.length}...`,
                progress,
                'adding'
            );

            await ResponseHandler.retryWithNewToken(
                async (token: string) => {
                    const response = await fetch(`${this.baseUrl}/playlists/${playlistId}/tracks`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            uris: batch
                        })
                    });

                    if (!response.ok) {
                        throw new Error('Failed to add tracks to playlist');
                    }
                },
                async () => await this.getAccessToken()
            );

            // Add a small delay between batches
            if (i + BATCH_SIZE < foundTracks.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (notFoundTracks.length > 0) {
            console.warn('Some tracks were not found:', notFoundTracks);
        }
    }

    private static async getCurrentUserId(): Promise<string> {
        return ResponseHandler.retryWithNewToken(
            async (token: string) => {
                const response = await fetch(`${this.baseUrl}/me`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to get user profile');
                }

                const data = await response.json();
                return data.id;
            },
            async () => await this.getAccessToken()
        );
    }
}