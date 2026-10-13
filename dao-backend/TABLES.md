# Tables applicatives — 59 tables

Catalogue vérifié par le contrat de schéma frais jusqu'à
`20261013014522_contract_v1_foundation.sql`. Les façades RPC publiques et les
fonctions `dao_private` ne sont pas des tables. Supabase Auth et Storage restent
des services gérés séparément.

1. `governorates`
2. `delegations`
3. `localities`
4. `trades`
5. `profiles`
6. `profile_contacts`
7. `user_roles`
8. `contractor_profiles`
9. `contractor_trades`
10. `contractor_service_areas`
11. `projects`
12. `project_private_details`
13. `project_versions`
14. `project_requests`
15. `project_request_versions`
16. `project_version_requests`
17. `project_reviews`
18. `publications`
19. `publication_requests`
20. `publication_recipients`
21. `ai_runs`
22. `ai_proposals` (avec `request_id` optionnel pour les propositions de lot)
23. `bids`
24. `bid_versions`
25. `bid_items`
26. `bid_groups`
27. `bid_group_items`
28. `awards`
29. `award_items`
30. `contracts`
31. `contract_versions`
32. `contract_parties`
33. `conversations`
34. `conversation_participants`
35. `messages`
36. `documents`
37. `document_grants`
38. `notifications`
39. `audit_events`
40. `command_receipts`
41. `portfolio_projects`
42. `portfolio_assets`
43. `bid_documents`
44. `project_members`
45. `project_invitations`
46. `award_cancellations`
47. `bid_item_results`
48. `account_states`
49. `review_assignments`
50. `request_sub_lots`
51. `request_sub_lot_versions`
52. `publication_lot_withdrawals`
53. `notification_outbox`
54. `staff_invitation_requests`
55. `contractor_profile_details`
56. `contractor_files`
57. `contract_items`
58. `contract_events`
59. `contract_archives`

Auth et Storage sont gérés par Supabase et ne sont pas recomptés.
