import { describe, expect, it } from 'vitest';
import { SessionManager } from './session_manager.js';

describe('SessionManager draft and persistence state', () => {
    it('uses null currentSessionId for draft state', () => {
        const manager = new SessionManager();
        const session = manager.createSession();

        expect(manager.currentSessionId).toBe(session.id);

        manager.enterDraft();

        expect(manager.currentSessionId).toBeNull();
        expect(manager.getCurrentSession()).toBeNull();
    });

    it('filters blank sessions during restore, sorting, and persistence', () => {
        const manager = new SessionManager();
        const blankSession = {
            id: 'blank',
            title: 'New Chat',
            timestamp: 200,
            messages: [],
        };
        const realSession = {
            id: 'real',
            title: 'Hello',
            timestamp: 100,
            messages: [{ role: 'user', text: 'Hello' }],
        };

        manager.currentSessionId = blankSession.id;
        manager.setSessions([blankSession, realSession]);

        expect(manager.currentSessionId).toBeNull();
        expect(manager.sessions).toEqual([realSession]);
        expect(manager.getPersistableSessions()).toEqual([realSession]);
        expect(manager.getSortedSessions()).toEqual([realSession]);
    });

    it('does not invent a new session after deleting the last persisted session', () => {
        const manager = new SessionManager();
        manager.setSessions([
            {
                id: 'real',
                title: 'Hello',
                timestamp: 100,
                messages: [{ role: 'user', text: 'Hello' }],
            },
        ]);
        manager.setCurrentId('real');

        const switchNeeded = manager.deleteSession('real');

        expect(switchNeeded).toBe(true);
        expect(manager.sessions).toEqual([]);
        expect(manager.currentSessionId).toBeNull();
        expect(manager.getPersistableSessions()).toEqual([]);
    });

    it('sorts pinned sessions first and switches to a pinned session after deleting current', () => {
        const manager = new SessionManager();
        manager.setSessions([
            {
                id: 'older',
                title: 'Older',
                timestamp: 100,
                messages: [{ role: 'user', text: 'Older' }],
            },
            {
                id: 'pinned',
                title: 'Pinned',
                timestamp: 50,
                messages: [{ role: 'user', text: 'Pinned' }],
                isPinned: true,
            },
            {
                id: 'current',
                title: 'Current',
                timestamp: 300,
                messages: [{ role: 'user', text: 'Current' }],
            },
        ]);
        manager.setCurrentId('current');

        expect(manager.getSortedSessions().map((session) => session.id)).toEqual([
            'pinned',
            'current',
            'older',
        ]);

        manager.deleteSession('current');

        expect(manager.currentSessionId).toBe('pinned');
    });

    it('renames, pins, and duplicates a session without copying live context', () => {
        const manager = new SessionManager();
        manager.setSessions([
            {
                id: 'real',
                title: 'Hello',
                timestamp: 100,
                messages: [{ role: 'user', text: 'Hello' }],
                context: { sensitive: true },
                contextSummary: { sourceMessageCount: 1 },
                groupId: 'group-1',
            },
        ]);

        expect(manager.updateSessionTitle('real', 'Research')).toBe(true);
        expect(manager.toggleSessionPinned('real')).toBe(true);
        const duplicate = manager.duplicateSession('real', (title) => `${title} copy`);

        expect(manager.getSessionById('real')).toEqual(
            expect.objectContaining({ title: 'Research', isPinned: true })
        );
        expect(duplicate).toEqual(
            expect.objectContaining({
                title: 'Research copy',
                context: null,
                groupId: 'group-1',
                isPinned: false,
            })
        );
        expect(duplicate.contextSummary).toBeUndefined();
        expect(duplicate.messages).toEqual([{ role: 'user', text: 'Hello' }]);
    });

    it('stores full user attachment metadata while keeping image compatibility fields', () => {
        const manager = new SessionManager();
        const session = manager.createSession();

        manager.addMessage(session.id, 'user', 'Review files', [
            {
                base64: 'data:image/png;base64,AAAA',
                type: 'image/png',
                name: 'diagram.png',
            },
            {
                base64: 'data:application/pdf;base64,BBBB',
                type: 'application/pdf',
                name: 'spec.pdf',
            },
        ]);

        expect(session.messages[0]).toEqual({
            role: 'user',
            text: 'Review files',
            image: ['data:image/png;base64,AAAA'],
            attachments: [
                {
                    base64: 'data:image/png;base64,AAAA',
                    type: 'image/png',
                    name: 'diagram.png',
                },
                {
                    base64: 'data:application/pdf;base64,BBBB',
                    type: 'application/pdf',
                    name: 'spec.pdf',
                },
            ],
        });
    });

    it('creates, renames, toggles, and deletes chat groups', () => {
        const manager = new SessionManager();
        manager.setSessions([
            {
                id: 'session-1',
                title: 'Hello',
                timestamp: 100,
                messages: [{ role: 'user', text: 'Hello' }],
            },
        ]);

        const group = manager.createGroup('Work');

        expect(group).toEqual(expect.objectContaining({ title: 'Work', isExpanded: true }));
        expect(manager.moveSessionToGroup('session-1', group.id)).toBe(true);
        expect(manager.getSessionById('session-1').groupId).toBe(group.id);

        expect(manager.updateGroupTitle(group.id, 'Research')).toBe(true);
        expect(manager.getPersistableGroups()[0].title).toBe('Research');

        expect(manager.toggleGroupExpansion(group.id)).toBe(true);
        expect(manager.getPersistableGroups()[0].isExpanded).toBe(false);

        expect(manager.deleteGroup(group.id)).toBe(true);
        expect(manager.getPersistableGroups()).toEqual([]);
        expect(manager.getSessionById('session-1').groupId).toBeNull();
    });

    it('records a finalized AI reply on the session it belongs to', () => {
        const manager = new SessionManager();
        manager.setSessions([
            {
                id: 'session-1',
                title: 'Hello',
                timestamp: 100,
                messages: [{ role: 'user', text: 'Hello' }],
            },
        ]);

        expect(
            manager.addAiMessage('session-1', {
                text: 'Answer',
                thoughts: 'Reasoning',
                thoughtsDurationSeconds: 4,
                sources: [{ url: 'https://example.test' }],
                images: [{ url: 'https://example.test/a.png' }],
                suppressCopy: true,
            })
        ).toBe(true);

        const [message] = manager.getSessionById('session-1').messages.slice(-1);
        expect(message).toEqual({
            role: 'ai',
            text: 'Answer',
            thoughts: 'Reasoning',
            thoughtsDurationSeconds: 4,
            sources: [{ url: 'https://example.test' }],
            generatedImages: [{ url: 'https://example.test/a.png' }],
            suppressCopy: true,
        });

        expect(manager.addAiMessage('missing-session', { text: 'Answer' })).toBe(false);
    });

    it('removes several sessions at once and moves off the current one', () => {
        const manager = new SessionManager();
        manager.setSessions([
            {
                id: 'session-1',
                title: 'One',
                timestamp: 300,
                messages: [{ role: 'user', text: 'a' }],
            },
            {
                id: 'session-2',
                title: 'Two',
                timestamp: 200,
                messages: [{ role: 'user', text: 'b' }],
            },
            {
                id: 'session-3',
                title: 'Three',
                timestamp: 100,
                messages: [{ role: 'user', text: 'c' }],
            },
        ]);
        manager.setCurrentId('session-2');

        const result = manager.deleteSessions(['session-2', 'session-3']);

        expect(result).toEqual({ deletedCount: 2, wasCurrent: true });
        expect(manager.sessions.map((session) => session.id)).toEqual(['session-1']);
        expect(manager.currentSessionId).toBe('session-1');
    });

    it('ignores bulk deletions without ids', () => {
        const manager = new SessionManager();
        manager.setSessions([
            {
                id: 'session-1',
                title: 'One',
                timestamp: 100,
                messages: [{ role: 'user', text: 'a' }],
            },
        ]);

        expect(manager.deleteSessions([])).toEqual({ deletedCount: 0, wasCurrent: false });
        expect(manager.sessions).toHaveLength(1);
    });

    it('keeps empty reply fields out of the recorded AI message', () => {
        const manager = new SessionManager();
        manager.setSessions([
            {
                id: 'session-1',
                title: 'Hello',
                timestamp: 100,
                messages: [{ role: 'user', text: 'Hello' }],
            },
        ]);

        manager.addAiMessage('session-1', {
            text: 'Answer',
            thoughts: '',
            sources: [],
            images: [],
        });

        expect(manager.getSessionById('session-1').messages.at(-1)).toEqual({
            role: 'ai',
            text: 'Answer',
        });
    });
});
