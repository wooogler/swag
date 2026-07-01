-- SWAG Dataset build: bundle 3 assignments, copy sessions with P0.. renumbering.
\set ON_ERROR_STOP on
BEGIN;

-- 1) New bundled assignment
INSERT INTO assignments
  (id, title, instructions, criteria, deadline, share_token, instructor_id,
   custom_system_prompt, include_instruction_in_prompt, allow_web_search,
   strict_paste_blocking, created_at)
VALUES
  ('03201d5d-08c7-4db1-8e5c-f5edc6563d9a',
   'SWAG Dataset (Personal Use of AI — Student Essays)',
   '[{"id": "13f83002-44c9-445f-9a49-b9a4d8dc35e9", "type": "paragraph", "props": {"backgroundColor": "yellow", "textColor": "default", "textAlignment": "left"}, "content": [{"type": "text", "text": "SWAG Dataset — bundled student writing sessions from three “Personal Use of AI” assignments (101 participants, renumbered P0–P100). All three used the identical chatbot prompt. The task instructions came in two near-identical variants, shown below.", "styles": {"bold": true}}], "children": []}, {"id": "3d2631c2-8127-45bb-aa76-78f867516046", "type": "paragraph", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}, "content": [{"type": "text", "text": "▸ Variant A — used by “Personal Use of AI (CS 222)” and “Personal Use of AI (CS 405 Sections -001/002)” (Tamara Maddox, GMU). These two were word-for-word identical.", "styles": {"bold": true}}], "children": []}, {"id": "68aabccd-c98f-4dac-a78b-bd36137f1837", "type": "paragraph", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}, "content": [{"type": "text", "text": "AI assistants such as Claude and ChatGPT have now become ubiquitous.  Some have even begun using ChatGPT to produce their personal correspondence, create responses for new potential love interests on dating sites, or even as surrogates to replace human companionship altogether! How might these uses change us, both as a society and as individual humans? Make a thoughtful discussion post that provides at least a short paragraph for each of the following three three questions:", "styles": {}}], "children": []}, {"id": "5afe3f58-5889-41d5-a87c-595169dfd60e", "type": "bulletListItem", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}, "content": [{"type": "text", "text": "What type of use have YOU made of AI assistance in the past year?", "styles": {}}], "children": []}, {"id": "d89651f3-9b8e-44b4-b247-268ff9e94615", "type": "bulletListItem", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}, "content": [{"type": "text", "text": "What do you think of using AI to create wholesale letters and other correspondence for personal (not business or school) purposes?  Does this change the nature of interpersonal relationships?", "styles": {}}], "children": []}, {"id": "8bb58702-8501-43a5-abfd-5f986432c703", "type": "bulletListItem", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}, "content": [{"type": "text", "text": "What do you think of using AI as a supplement or replacement for human friends and/or online romantic partners?", "styles": {}}], "children": []}, {"id": "a5de155a-57e3-46b7-a23a-7a2668359426", "type": "paragraph", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}, "content": [{"type": "text", "text": "Finally, conclude your post by suggesting what, if anything, we as a society should do to restrict the growth of AI in the future, based on your above discussion.", "styles": {}}], "children": []}, {"id": "f0ce9250-bebf-4a5a-9b5e-d7753cd90a92", "type": "paragraph", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}, "content": [], "children": []}, {"id": "623160fa-6f4e-470d-a0bc-a88ebb4ed673", "type": "paragraph", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}, "content": [], "children": []}, {"id": "c9f86ce1-53e1-4b69-b9bc-fe79533b5e98", "type": "paragraph", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}, "content": [{"type": "text", "text": "▸ Variant B — used by “Essay on AI in Writing” (Dan Dunlap, Virginia Tech). Same theme and same chatbot prompt, but reworded as an essay with a slightly different question set (drops the “your own past use” question, adds “how might these change us,” and omits the restrict-AI conclusion).", "styles": {"bold": true}}], "children": []}, {"id": "349abc51-b8a2-445c-81f7-39a516c1b82d", "type": "paragraph", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}, "content": [{"type": "text", "text": "AI assistants such as Claude and ChatGPT have now become part of everyday life.  Some people use them for basic tasks like drafting messages or brainstorming ideas. Others are beginning to experiment with using AI to produce their personal correspondence, create responses for new potential love interests on dating sites, or even as surrogates to replace human companionship altogether! As these tools become more capable, it is getting harder to distinguish between human and AI-generated language, to define where human input ends and AI assistance begins, and to identify areas of life that are not touched by these systems. It’s one thing to ask how AI changes the work we produce, but it’s another to ask how it might be shaping us, our habits, our relationships, and even people who choose not to use it.", "styles": {}}], "children": []}, {"id": "235ccf7a-a371-4302-950e-f3ce15a05a55", "type": "paragraph", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}, "content": [{"type": "text", "text": "Write a thoughtful essay that provides at least a short paragraph for each of the following three questions:", "styles": {}}], "children": []}, {"id": "f92fef4b-d516-4f31-923b-06c041276620", "type": "bulletListItem", "props": {"backgroundColor": "default", "textColor": "rgb(0, 0, 0)", "textAlignment": "left"}, "content": [{"type": "text", "text": "What do you think of using AI to create wholesale letters and other correspondence for personal (not school or work) purposes?  Does this change the nature of interpersonal relationships?", "styles": {}}], "children": []}, {"id": "7d3f223d-972c-4cb9-9a63-f3e2b78278e5", "type": "bulletListItem", "props": {"backgroundColor": "default", "textColor": "rgb(0, 0, 0)", "textAlignment": "left"}, "content": [{"type": "text", "text": "What do you think of using AI as a supplement or replace human companionship?", "styles": {}}], "children": []}, {"id": "5b342727-c5ef-4939-ab41-eca1840bc840", "type": "bulletListItem", "props": {"backgroundColor": "default", "textColor": "rgb(0, 0, 0)", "textAlignment": "left"}, "content": [{"type": "text", "text": "How might these uses change us, both as a society and as individual humans?", "styles": {}}], "children": []}, {"id": "864dec6e-10cf-496f-a730-2c3ac454c56f", "type": "paragraph", "props": {"backgroundColor": "default", "textColor": "default", "textAlignment": "left"}, "content": [], "children": []}]',
   NULL,
   TIMESTAMP '2026-05-06 23:59:00',
   'swag-dataset',
   '00d27d39-ef3e-498f-9156-e1118b4a93fe',
   'You are a supportive writing coach for students. Help them brainstorm, organize ideas, revise for clarity, and improve grammar. Do not write the full assignment for them. Keep feedback practical, brief, and focused on helping the student produce original work.',
   false, false, true, now());

-- 2) Session map with continuous P0.. renumbering.
--    Order: CS222 (P0-35), CS405-001/002 (P36-72), Essay (P73-100); within each by original P-number.
CREATE TEMP TABLE sess_map AS
SELECT s.id AS old_id,
       gen_random_uuid()::text AS new_id,
       'P' || (ROW_NUMBER() OVER (
                 ORDER BY CASE s.assignment_id
                            WHEN '7f0eb4b1-44c4-47db-990b-4bbe7c48dc06' THEN 0
                            WHEN '39ec163d-86af-46eb-bf2d-d3d1ad038c75' THEN 1
                            WHEN '0f790ee7-f5ec-4e46-a863-0b9e4075de7b' THEN 2
                          END,
                 NULLIF(regexp_replace(s.participant_token, '\D', '', 'g'), '')::int,
                 s.started_at, s.id) - 1)::text AS ptoken
FROM student_sessions s
WHERE s.assignment_id IN ('7f0eb4b1-44c4-47db-990b-4bbe7c48dc06','39ec163d-86af-46eb-bf2d-d3d1ad038c75','0f790ee7-f5ec-4e46-a863-0b9e4075de7b');

-- 3) Copy sessions (new id, new assignment, renumbered participant_token)
INSERT INTO student_sessions
  (id, assignment_id, user_id, participant_token, student_first_name, student_last_name,
   student_email, password, is_verified, started_at, last_saved_at, last_login_at, metadata)
SELECT m.new_id, '03201d5d-08c7-4db1-8e5c-f5edc6563d9a', s.user_id, m.ptoken, s.student_first_name, s.student_last_name,
       s.student_email, s.password, s.is_verified, s.started_at, s.last_saved_at, s.last_login_at, s.metadata
FROM student_sessions s JOIN sess_map m ON m.old_id = s.id;

-- 4) Copy editor_events (id is serial -> omit; remap session_id)
INSERT INTO editor_events (session_id, event_type, event_data, timestamp, sequence_number)
SELECT m.new_id, e.event_type, e.event_data, e.timestamp, e.sequence_number
FROM editor_events e JOIN sess_map m ON m.old_id = e.session_id;

-- 5) Conversation map
CREATE TEMP TABLE conv_map AS
SELECT c.id AS old_id, gen_random_uuid()::text AS new_id, m.new_id AS new_session_id
FROM chat_conversations c JOIN sess_map m ON m.old_id = c.session_id;

INSERT INTO chat_conversations (id, session_id, title, created_at)
SELECT cm.new_id, cm.new_session_id, c.title, c.created_at
FROM chat_conversations c JOIN conv_map cm ON cm.old_id = c.id;

-- 6) Copy chat_messages (id serial -> omit; remap conversation_id)
INSERT INTO chat_messages (conversation_id, role, content, metadata, timestamp, sequence_number)
SELECT cm.new_id, msg.role, msg.content, msg.metadata, msg.timestamp, msg.sequence_number
FROM chat_messages msg JOIN conv_map cm ON cm.old_id = msg.conversation_id;

-- 7) Message map via natural key (new_conversation_id, sequence_number) [verified unique]
CREATE TEMP TABLE msg_map AS
SELECT o.id AS old_id, n.id AS new_id
FROM conv_map cm
JOIN chat_messages o ON o.conversation_id = cm.old_id
JOIN chat_messages n ON n.conversation_id = cm.new_id AND n.sequence_number = o.sequence_number;

-- 8) Copy score_classifications (id serial -> omit; remap all FKs)
INSERT INTO score_classifications
  (assignment_id, message_id, conversation_id, session_id, query_text, response_text,
   prev_query_text, prev_response_text, turn_index, query_timestamp, type_a, subtype_a,
   subtype_tags_b, subtype_scores_b, raw_response_a, raw_response_b, model, classifier_version, classified_at)
SELECT '03201d5d-08c7-4db1-8e5c-f5edc6563d9a', mm.new_id, cm.new_id, sm.new_id, sc.query_text, sc.response_text,
       sc.prev_query_text, sc.prev_response_text, sc.turn_index, sc.query_timestamp, sc.type_a, sc.subtype_a,
       sc.subtype_tags_b, sc.subtype_scores_b, sc.raw_response_a, sc.raw_response_b, sc.model, sc.classifier_version, sc.classified_at
FROM score_classifications sc
JOIN msg_map  mm ON mm.old_id = sc.message_id
JOIN conv_map cm ON cm.old_id = sc.conversation_id
JOIN sess_map sm ON sm.old_id = sc.session_id
WHERE sc.assignment_id IN ('7f0eb4b1-44c4-47db-990b-4bbe7c48dc06','39ec163d-86af-46eb-bf2d-d3d1ad038c75','0f790ee7-f5ec-4e46-a863-0b9e4075de7b');

-- 9) Export the participant tracking map (client-side; temp tables alive in this txn)
\copy (SELECT m.ptoken AS new_token, a.title AS source_assignment, s.participant_token AS orig_token, s.student_first_name, s.student_last_name, s.student_email, s.started_at, s.id AS orig_session_id, m.new_id AS new_session_id FROM sess_map m JOIN student_sessions s ON s.id=m.old_id JOIN assignments a ON a.id=s.assignment_id ORDER BY (substring(m.ptoken from 2))::int) TO '/tmp/claude-1000/-home-sangwonlee-swag/4aa34a2c-24bc-4f90-b4ac-6f2f869c492b/scratchpad/mapping.csv' WITH CSV HEADER

COMMIT;
