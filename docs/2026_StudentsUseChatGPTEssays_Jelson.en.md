# An Empirical Study to Understand How Students Use ChatGPT for Writing Essays

**Andrew Jelson**  
jelson9854@vt.edu  
Computer Science Virginia Tech Blacksburg, Virginia, USA

**Daniel Manesh**  
danielmanesh@vt.edu  
Virginia Tech Blacksburg, Virginia, USA

**Alice Jang**  
ajjang@vt.edu  
Virginia Tech Blacksburg, Virginia, USA

**Daniel Dunlap**  
dunlapd@vt.edu  
Computer Science Virginia Tech Blacksburg, Virginia, USA

**Young-Ho Kim**  
yghokim@younghokim.net  
NAVER AI Lab Seongnam, Republic of Korea

**Sang Won Lee ∗**  
sangwonlee@vt.edu  
Virginia Tech Blacksburg, Virginia, USA  
NAVER AI Lab Seongnam, Republic of Korea

# Abstract

As large language models (LLMs) become widespread, students increasingly turn to systems like ChatGPT for writing tasks. Educators worry that this reliance may reduce critical engagement with writing and hinder students' learning processes. Although datasets exist on students' use of LLMs for writing, how they functionally use ChatGPT in detail-and how this usage shapes their writing and perceptions-remains underexplored. We conducted an online study (n=77) in which students wrote an essay using an in-house ChatGPT we developed to capture their queries. Through qualitative analysis, we identified the types of assistance students sought and presented patterns of use, ranging from asking for opinions on a topic to delegating the entire writing task to ChatGPT. We also found that students' writing self-efficacy influenced their querying patterns and that levels of ownership and creativity varied depending on how they used ChatGPT. This study contributes empirical data to ongoing discussions about how writing education should incorporate or regulate LLM-powered tools.

# CCS Concepts

· Human-centered computing → Empirical studies in HCI ; HCI theory, concepts and models ; · Computing methodologies → Natural language generation ; Artificial intelligence .

# Keywords

Education/Learning, Empirical Study That Tells Us How People Use A System, ChatGPT, Writing with AI, Vibe Writing

# 1 Introduction

Writing is fundamental to effective learning, allowing learners to critically engage with the topics they study [[6, Applebee 1984, Writing and Reasoning](#ref-6); [35, Emig 1977, Writing as a Mode of Learning](#ref-35)], with the pedagogical value being the process itself, planning arguments, translating ideas into words, and revising to clarify concepts [[39, Flower & Hayes 1981, Cognitive Process Theory](#ref-39)]. The emergence of generative AI (GenAI) tools, such as ChatGPT, Google Gemini, and Claude, has disrupted traditional educational paradigms by allowing students to offload writing tasks to AI [[51, Herman 2022, The End of High-School English](#ref-51); [75, Marche 2022, College Essay](#ref-75)]. Educators have expressed growing concerns about how students might use GenAI when instructors give students writing assignments (e.g. reflective essays) designed to facilitate students' critical engagement with a topic [[3, AlAfnan et al. 2023, ChatGPT](#ref-3); [82, Perkins 2023, Academic Integrity Considerations](#ref-82); [87, Sallam 2023, ChatGPT Utility in Healthcare](#ref-87)].

Understanding the potential risks and benefits of using LLMpowered tools is challenging because student usage remains understudied. As a result, educators' ability to assess the impact of LLMs on student learning is limited. While some uses of ChatGPT may be less problematic than generating an entire essay (e.g., spelling correction), even limited usage can still negatively impact the learning process, depending on the learning context. For example, asking an LLM to choose one perspective on a divisive topic can deprive students of the opportunity to think critically about opposing viewpoints. However, these expectations remain speculative and are not necessarily evidence-based [[92, Shibani & Shum 2024, AI-Assisted Writing](#ref-92); [104, Wang & Fan 2025, ChatGPT](#ref-104)]. Therefore, in order for educators to assess its impact on learning, it is crucial to understand how students use ChatGPT based on their objectives and usage patterns. While students' actual use of GenAI for writing has been studied [[25, Chen et al. 2025, CoachGPT](#ref-25); [43, Göldi et al. 2024, Intelligent Support Engages Writers](#ref-43); [109, Wilbers et al. 2024, Overall Writing Effectiveness](#ref-109)] and made available through datasets [[49, Han et al., RECIPE4U](#ref-49); [69, Lee et al. 2022, CoAuthor](#ref-69); [71, Liu et al. 2024, Detectability of ChatGPT Content](#ref-71)], a detailed analysis of how they functionally use GenAI, what factors predict their GenAI usage, and how such usage influences their writing and perceptions remains underexplored.

This study addresses these gaps by observing students writing an argumentative essay with trace data collection and integrated analysis. We conducted an online study where 77 college students were asked to write an essay using ChatGPT, which was accessible on a custom online platform that we developed to capture the queries they made to ChatGPT-queries that are typically hidden from instructors. In addition, we captured their keystrokes, copying, and pasting behaviors to follow how the writing process was affected by ChatGPT responses. This data-driven approach captures usage patterns across the writing process-rather than relying on self-reports-and allows us to connect user characteristics with behavioral patterns and resulting essay characteristics. We address the following research questions (shown in Figure 1).

![Figure 1](images/figure-1.png)

> **Figure 1:** The overview of Research Questions


We categorized all ChatGPT queries based on Flower and Hayes's Cognitive Process Theory of Writing Model [[39, Flower & Hayes 1981, Cognitive Process Theory](#ref-39)], which structures the cognitive process into three categories: Planning , Translating , and Reviewing . We also added another category, All , to account for cases when a student relies on ChatGPT to write the entire essay or a subset of the essay, which delegates all three types of tasks at once (e.g., ' Write an essay in response to the following prompt. '). This taxonomy reveals the types of writing tasks students delegate to ChatGPT and provides a comprehensive overview of usage patterns across the writing process. In addition, the publicly available dataset collected in this study will allow educators and researchers to identify GenAI usage that they may fi nd problematic or beneficial for student learning and can enable follow-up studies on how instructors should incorporate GenAI into writing pedagogy.

In addition, we examined how individual student characteristics relate to ChatGPT usage patterns.

- RQ2: What factors can predict how students use ChatGPT?

In particular, we used two specific constructs to account for individual differences, along with demographic information: self-efficacy in writing (SEWS) and the perceived acceptance of ChatGPT measured by the Technology Acceptance Model (TAM). Writing self-efficacy reflects a student's confidence in their ability to perform various writing tasks. Prior research indicates that students with lower self-efficacy in writing are more inclined to seek external assistance or rely on tools to simplify the writing process [[77, McCarthy et al., Self-Efficacy and Writing](#ref-77); [110, Woodrow 2011, College English Writing Affect](#ref-110)]. TAM captures attitudes towards perceived usefulness and ease of use for a technology, factors that predict actual usage [[86, Saif et al. 2024, Technology Acceptance Model](#ref-86)]. By combining these surveys with demographic data, we investigate how students' attitudes toward GenAI and their writing confidence correlate with usage patterns.

Based on usage patterns, we grouped participants into six groups to answer the following:

- RQ3: How does students' ChatGPT usage manifest in their writing?

We analyzed the interaction traces to understand how the essays were composed , examining three characteristics: word count, essay composition (student versus ChatGPT), and readability scores measured with the Flesch-Kincaid Grade Level [[38, Flesch 1948, Readability Yardstick](#ref-38)] and Dale-Chall [[30, Dale & Chall 1948, Predicting Readability](#ref-30)] metrics. By comparing these characteristics across clusters, we discuss how different usage patterns relate to essay length and linguistic complexity.

Lastly, we investigated how ChatGPT use relates to students' subjective writing experience, addressed in the following research question:

- RQ4: How does students' ChatGPT usage shape their perception of the writing experience?

We assessed two dimensions of the subjective writing experience: perceived ownership (PO) [[7, Avey et al. 2009, Psychological Ownership](#ref-7); [23, Chantal 2012, Psychological Ownership](#ref-23)]-the students' sense of ownership of the essay-and the Creativity Support Index (CSI) [[26, Cherry & Latulipe 2014, Creativity Support Index](#ref-26)]-their reflection on how ChatGPT supported their writing practice. PO is particularly important in educational settings, where feelings of authorship and accountability are closely related to learning outcomes and academic integrity [[23, Chantal 2012, Psychological Ownership](#ref-23); [60, Joshi & Vogel 2025, Writing with AI](#ref-60); [111, Yang & McDonnell 2024, Student Definitions of Ownership](#ref-111)]. To complement this, we used the CSI to assess how engaging and meaningful students found the AI-supported writing process [[26, Cherry & Latulipe 2014, Creativity Support Index](#ref-26); [41, Gero et al. 2022, Sparks](#ref-41); [56, Ivcevic & Grandinetti 2024, Artificial Intelligence as a Tool](#ref-56)]. By understanding engagement, we gain insight into whether students remain engaged in the writing process when ChatGPT performs cognitive work, a potential risk to learning. Together, these measures reveal how the use of GenAI affects students' sense of ownership and engagement in writing tasks.

Our work contributes to understanding GenAI in writing education by providing four key contributions:

- Empirical, data-driven understanding of how college students use GenAI while writing, grounded in Flower and Hayes's Cognitive Process Theory of Writing.
- Insights into how user characteristics (e.g., age, race, gender, writing efficacy) relate to distinct GenAI usage patterns during writing.
- Understanding of how students' essays and their perceptions of their writing vary across usage patterns.
- A publicly available dataset of students' GenAI interactions (queries and responses) paired with fi ne-grained editor interaction traces (keystrokes, copy-paste actions) from an argumentative essay writing task.

The results revealed distinct patterns of ChatGPT usage, which we categorized each query into six groups, reflecting its role as an ideation partner, editor, ghostwriter, or some combination of these. We also identified a mode of vibe writing in which a subset of students compose essays by instructing ChatGPT to generate desirable outputs. Our fi ndings indicate that SEWS predicts the frequency of ChatGPT use, and that students who rely on ChatGPT for planning or reviewing reported a comparable sense of ownership over their work, results that may raise concerns for educators. These insights-along with our publicly available dataset-provide educators and researchers with empirical resources to inform future GenAI policies, enabling them to examine how students' GenAI use may influence learning outcomes.

# 2 Related Work

Research on the different aspects of intelligent assistants powered by LLM-based generative AI has been conducted in a variety of fields. In this section, we discuss GenAI's impact on education, AI writing support tools, and general attitudes surrounding GenAI tool usage.

## 2.1 Mitigating the Impact of Generative AI in Education

With the release of tools like ChatGPT, GenAI has become widely accessible as a conversational agent capable of responding to text, image, and audiovisual queries. A 2024 Common Sense Media survey reported that 70% of US teens-many soon entering university-had used generative AI, with more than half applying it to academic writing tasks such as idea generation and assignment completion [[74, Madden et al. 2024, Dawn of the AI Era](#ref-74)]. In university admissions, students feel pressured to use AI because they think their peers use it [[37, Fitzsimons et al. 2025, Pressure to Use AI](#ref-37)].

This rapid spread of GenAI is raising concerns among educators. The heavy reliance on GenAI can hinder critical thinking and selfevaluation, lower students' confidence, and encourage uncritical acceptance of AI output, which risks amplifying inherent biases and reinforcing discriminatory viewpoints [[52, Holmes et al. 2023, Guidance for Generative AI](#ref-52); [57, Jakesch et al. 2023, Co-Writing with Opinionated Language Models](#ref-57)]. Using LLMs may reduce mental effort [[98, Stadler et al. 2024, Cognitive Ease](#ref-98)] and overall brain activity [[65, Kosmyna et al. 2025, Your Brain on ChatGPT](#ref-65)] and may result in student work that lacks depth [[98, Stadler et al. 2024, Cognitive Ease](#ref-98)]. As students offload tasks to ChatGPT, they may hinder their own learning process by limiting the skills they develop.

Additionally, there are ethical concerns focusing on plagiarism and cheating [[28, Cotton et al. 2023, Chatting and Cheating](#ref-28); [61, Kasneci et al., ChatGPT for Good](#ref-61); [99, Tan et al. 2024, Seat at the Table](#ref-99)]. Studies show that AI-generated text often evades plagiarism detectors [[79, Orenstrakh et al. 2024, Detecting LLM-Generated Text](#ref-79); [83, Quidwai et al. 2023, Beyond Black Box AI](#ref-83); [113, Zeng et al. 2024, Detecting AI-Generated Sentences](#ref-113)], although new detectors demonstrate improved accuracy [[83, Quidwai et al. 2023, Beyond Black Box AI](#ref-83)], and log fi le analysis has proven reliable for identifying unique writing patterns [[91, Schneider et al. 2018, Detecting Plagiarism](#ref-91)]. However, claiming GenAI misuse without definitive proof is risky and can lead to legal and ethical challenges [[106, Warrier 2024, Ph.D. Student Sues UMN](#ref-106)]. Educators also worry about grading fairness, the difficulty in detecting ChatGPT use, and the broader risk of students losing opportunities to gain knowledge through active engagement [[3, AlAfnan et al. 2023, ChatGPT](#ref-3); [32, Cotton et al. 2024, Chatting and Cheating](#ref-32)].

Researchers have examined the policies and regulations that govern LLM-powered tools in education. Some advocate strict policies and regulatory frameworks [[1, Adams et al. 2022, Teachers' New Ethical Obligations](#ref-1); [14, Biswas 2023, Role of Chat GPT](#ref-14); [28, Cotton et al. 2023, Chatting and Cheating](#ref-28); [47, Halaweh 2023, ChatGPT](#ref-47); [96, Sok & Heng 2023, ChatGPT for Education](#ref-96)], while others argue that adoption is inevitable and can be beneficial when guided appropriately [[10, Barrett & Pack 2023, Not Quite Eye to A.I.](#ref-10); [16, Bower et al. 2024, ChatGPT Teacher Survey](#ref-16); [105, Wang et al. 2023, Role of AI Assistants](#ref-105)]. Educators face the challenge of integrating GenAI into their classrooms. Students often treat AI tools as collaborators in complex problem solving, with researchers documenting various use cases of AI in education [[10, Barrett & Pack 2023, Not Quite Eye to A.I.](#ref-10); [16, Bower et al. 2024, ChatGPT Teacher Survey](#ref-16); [49, Han et al., RECIPE4U](#ref-49); [70, Liu et al. 2024, Teaching CS50 with AI](#ref-70)]. Prior work highlights both benefits and challenges, offering strategies for effective classroom integration [[9, Baidoo-Anu & Ansah 2023, Generative Artificial Intelligence](#ref-9); [81, Park & Ahn 2024, Promise and Peril of ChatGPT](#ref-81); [97, Song & Song 2023, Enhancing Academic Writing Skills](#ref-97); [104, Wang & Fan 2025, ChatGPT](#ref-104)]. For example, Park and Ahn identified the strengths and weaknesses of ChatGPT with students and stakeholders, providing design ideas for classroom use [[81, Park & Ahn 2024, Promise and Peril of ChatGPT](#ref-81)]. Similarly, Harvey et al. recommends encouraging students to use ChatGPT for support when stuck, rather than as a replacement for problem-solving [[50, Harvey et al. 2025, Don't Forget the Teachers](#ref-50)], while Jeon and Lee propose strategies to foster complementary relationships between students, teachers, and AI [[58, Jeon & Lee 2023, Large Language Models in Education](#ref-58)]. Research in HCI and education further emphasizes how LLMs can be integrated to deepen engagement and support meaningful learning experiences [[54, Hwang & Chang 2021, Opportunities and Challenges of Chatbots](#ref-54); [61, Kasneci et al., ChatGPT for Good](#ref-61); [92, Shibani & Shum 2024, AI-Assisted Writing](#ref-92)].

Although proper integration of GenAI may open a new avenue for education, our understanding of students' actual GenAI usage remains limited, with few studies focusing on native English speakers. Some researchers have investigated students' motivations for using tools like ChatGPT [[5, Ammari et al. 2025, Students Use ChatGPT](#ref-5); [15, Black & Tomlinson 2025, University Students Adopt AI](#ref-15); [95, Skjuve et al. 2024, User Motivations for ChatGPT](#ref-95); [107, Wasi et al. 2024, LLMs as Writing Assistants](#ref-107)], but these studies often rely on self-reported data or query histories submitted by self-selected participants. As a result, they offer only a partial view of how students interact with GenAI. Even when query data is available [[5, Ammari et al. 2025, Students Use ChatGPT](#ref-5)], it often lacks the academic context in which the questions were asked, and instructors typically do not have access to it, making it difficult to comprehensively assess the educational impact of GenAI. Additionally, gender and ethnicity influence awareness and understanding of ChatGPT [[19, Cachero et al. 2025, Gender Bias in Self-Perception](#ref-19); [45, Grassini & Ree 2023, Hope or Doom AI-ttitude](#ref-45)], potentially limiting which students turn to AI for support.

There is existing research providing comprehensive datasets of LLM usage [24, 49, 66, 69, 71, 105]. These datasets cover a variety of contexts, ranging from academic programming and problemsolving tasks [66, 105] to professional work environments [[24, Chatterji et al. 2025, How People Use ChatGPT](#ref-24)]. Most of these datasets only provide snapshots of the process, for example, only collecting queries. RECIPE4U is one of the rare exceptions-developed by Han et al.-that collected both editor states and queries during student-ChatGPT interactions as students completed a guided essay-revision task in an English as a Foreign Language (EFL) class [[49, Han et al., RECIPE4U](#ref-49)]. Because this dataset was collected in an EFL context, it primarily focuses on language-related queries and revision behaviors. We extend this line of work by moving beyond the EFL context and providing a detailed, process-level trace of students' interactions and writing behaviors, including keystroke and copy-paste events. This low-level data enables the reconstruction of the complete writing process and supports deeper analyses of the relationships between AI usage patterns and writing outcomes. This dataset will support a deeper understanding of the discourse around the risks of and responses to GenAI in education, while underscoring the need to examine its role in specific domains such as writing education [[49, Han et al., RECIPE4U](#ref-49); [61, Kasneci et al., ChatGPT for Good](#ref-61); [63, Knight et al. 2020, AcaWriter](#ref-63); [70, Liu et al. 2024, Teaching CS50 with AI](#ref-70); [92, Shibani & Shum 2024, AI-Assisted Writing](#ref-92)].

## 2.2 AI Writing Assistants in Education

Communicating ideas through writing is a critical skill across disciplines as it fosters critical thinking, analysis, and synthesis [[27, Condon & Kelly-Riley 2004, Assessing and Teaching What We Value](#ref-27); [35, Emig 1977, Writing as a Mode of Learning](#ref-35); [102, Wade 1995, Critical Thinking](#ref-102)]. To support this learning process, AI has long been incorporated into writing education through automated feedback systems and tutoring platforms [[2, Afrin et al. 2021, Student-Driven Revision Sessions](#ref-2); [29, Crompton & Burke 2023, Artificial Intelligence in Higher Education](#ref-29); [36, Escalante et al. 2023, AI-generated Feedback on Writing](#ref-36); [63, Knight et al. 2020, AcaWriter](#ref-63); [93, Shibani et al. 2019, Learning Analytics Design](#ref-93)].

Prior work demonstrates that AI writing assistants can improve the writing process and support learning. Commercial tools like Grammarly help users avoid plagiarism and improve writing quality, especially for EFL learners [[33, Dong & Shi 2021, Grammarly](#ref-33); [44, grammarly 2023, Grammarly](#ref-44); [64, Koltovskaia 2020, Automated Written Corrective Feedback](#ref-64)], though students often underuse capabilities [[53, Huang et al. 2020, Effectiveness of Using Grammarly](#ref-53)]. Educational systems like AcaWriter demonstrate that automated rhetorical feedback can support academic writing and improve essay quality [[63, Knight et al. 2020, AcaWriter](#ref-63)]. RECIPE extends this by integrating ChatGPT into EFL classrooms, showing that interactive revision support can improve performance and satisfaction compared to traditional instruction [[49, Han et al., RECIPE4U](#ref-49)]. Similarly, CoachGPT provides scaffolding-based support for essay planning and reviewing, with positive student perceptions [[25, Chen et al. 2025, CoachGPT](#ref-25)]. LegalWriter demonstrates benefits in interdisciplinary legal writing contexts, showing that LLM-based feedback improves writing quality and student learning outcomes [[108, Weber et al. 2024, LegalWriter](#ref-108)]. In parallel, Langsmith explored how Japanese learners use AI translation to complete writing tasks, fi nding that students relied heavily on the tool and focused more on text quality than manual translation [[55, Ito et al. 2020, Langsmith](#ref-55)].

To understand how these tools integrate into writing, researchers have turned to established writing frameworks, particularly Flower and Hayes' cognitive process theory. This writing process, a widely used writing framework, involves dynamically and recursively switching between three basic writing processes: Planning , Translating , and Reviewing [[39, Flower & Hayes 1981, Cognitive Process Theory](#ref-39)]. This model is grounded in the key point that ' writing is best understood as a set of distinctive thinking processes . ' The theory emphasizes think-aloud protocols, which capture a detailed record of a writer's cognitive processes during composition, rather than relying on post hoc introspection reflecting what writers believe should have happened. Drawing on this writing model and combining systematic literature review with user studies, these frameworks reveal patterns in how writers integrate AI across different phases and contexts [[43, Göldi et al. 2024, Intelligent Support Engages Writers](#ref-43); [68, Lee et al. 2024, Design Space for Writing Assistants](#ref-68); [84, Reza et al. 2025, Co-Writing with AI](#ref-84); [92, Shibani & Shum 2024, AI-Assisted Writing](#ref-92)]. This framework provides a way for how students integrate AI across writing phases, which we adopt in our analysis.

Beyond frameworks, recent research has examined how individual characteristics shape AI engagement in writing contexts. Joshi and Vogel investigates how well prompting strategies play into perceived ownership of essays [[60, Joshi & Vogel 2025, Writing with AI](#ref-60)], fi nding that ownership is impacted by the length and detail provided to ChatGPT inquiries. Other work suggests that perceived ownership is dependent on the specific writing tasks [[107, Wasi et al. 2024, LLMs as Writing Assistants](#ref-107)]. Using thematic coding grounded in cognitive writing theory, researchers have identified three key elements that shape AI engagement: a participant's personal values, their relationship with AI, and the different integration strategies, revealing how individual differences influence usage patterns [[46, Guo et al. 2025, From Pen to Prompt](#ref-46)].

HCI research has examined professional and creative writers' use of AI, revealing that they typically want assistance in translating ideas and reviewing their essays [[21, Chakrabarty et al. 2024, Creativity Support in the Age](#ref-21); [42, Gero et al. 2023, Social Dynamics of AI Support](#ref-42)]. These writers show varied expectations but general appreciation for ChatGPT's ability to generate unexpected, sometimes inspiring output [[42, Gero et al. 2023, Social Dynamics of AI Support](#ref-42); [69, Lee et al. 2022, CoAuthor](#ref-69); [103, Wan et al. 2024, Human-AI Co-creativity](#ref-103)]. However, less work has focused on students in authentic educational contexts -a critical gap as students are learning proper writing strategies. Research with students shows they engage more when using ChatGPT for reviewing processes [[43, Göldi et al. 2024, Intelligent Support Engages Writers](#ref-43)], and while LLM usage does not necessarily speed up writing, students report increased time spent engaging with their work and perceive higher quality [[43, Göldi et al. 2024, Intelligent Support Engages Writers](#ref-43); [109, Wilbers et al. 2024, Overall Writing Effectiveness](#ref-109)].

Despite these promising fi ndings, practitioners have raised concerns about the negative impacts of GenAI that are difficult to regulate, including weakened critical engagement [[34, Eke 2023, ChatGPT and the Rise](#ref-34); [51, Herman 2022, The End of High-School English](#ref-51); [72, Livingstone 2024, I Quit Teaching Because of ChatGPT](#ref-72); [75, Marche 2022, College Essay](#ref-75); [90, Scarfe et al. 2024, Artificial Intelligence Infiltration](#ref-90); [106, Warrier 2024, Ph.D. Student Sues UMN](#ref-106)]. Furthermore, research also shows limits to AI writing quality [[20, Chakrabarty et al. 2024, Art or Artifice](#ref-20); [85, Romoff et al. 2025, Large Language Models](#ref-85)]; AI-generated essays pass evaluation criteria 3-10 times less frequently than professional human-written essays [[20, Chakrabarty et al. 2024, Art or Artifice](#ref-20)]. These concerns highlight the importance of understanding how students use AI across different writing phases.

While this growing body of work provides valuable insights into AI adoption, perceptions, and writing processes, most observational studies of AI-assisted writing focus on professional or creative writers in controlled settings. Less attention has been paid to how students engage with GenAI during authentic academic writing tasks, and how their individual characteristics-such as writing ability, AI literacy, or personal values-shape these interactions. This gap motivates our study, which directly observes students using ChatGPT for essays through the lens of Flower and Hayes' framework to understand typical usage patterns, individual variation, and how students integrate AI across writing phases.

## 2.3 Attitude and Usage of AI

As artificial intelligence is a rapidly expanding fi eld, there is constant growth in understanding its adoption and perceived quality. In a 2023 study, Chan and Lee found that students were more likely than teachers to adopt new AI tools and had a more open-minded attitude about their use Other research looks at AI literacy and interest, talking about the importance of fostering positive attitudes towards AI [[12, Bewersdorff et al. 2025, AI Advocates and Cautious Critics](#ref-12)]. Ayanwale et al. studies this through teachers' intention to teach using AI [[8, Ayanwale et al. 2022, Teachers' Readiness](#ref-8)], while others performed thematic analysis or interviews to get an understanding of perception [[4, Ali et al. 2023, ChatGPT Learning Motivation](#ref-4); [94, Shoufan 2023, Students' Perceptions of ChatGPT](#ref-94)]. Other researchers study perceptions of AI quality and trustworthiness. Interestingly, users tend to accept AI suggestions regardless of agreement [[13, Bhat et al. 2023, Interacting with Next-Phrase Suggestions](#ref-13)], while others examine what makes responses perceived as helpful or unsuitable [[18, Buçinca et al. 2021, To Trust or to Think](#ref-18); [73, Ma et al. 2023, Who Should I Trust](#ref-73)]. They also discuss ways in which the user can improve the prompts to increase the likelihood of getting a good response. Zamfirescu-Pereira et al. expanded this idea, developing an accessible prompt engineering tool that doesn't require background knowledge of AI to use [[112, Zamfirescu-Pereira et al. 2023, Why Johnny Can't Prompt](#ref-112)]. Other research discusses prompting strategies and how gender plays a role in AI acceptance [[19, Cachero et al. 2025, Gender Bias in Self-Perception](#ref-19); [45, Grassini & Ree 2023, Hope or Doom AI-ttitude](#ref-45); [89, Sawalha et al. 2024, Student Prompts](#ref-89)], fi nding that people treat GenAI like humans, get better responses using revised prompts, and that women have more hesitation towards AI.

While this growing body of work provides valuable insight into AI adoption, literacy, and perceptions, it focuses largely on attitudes rather than the ways people, especially students, actually use GenAI in practice. In particular, little is known about how students engage with GenAI during authentic learning activities or how their individual characteristics shape these interactions. Understanding student usage requires moving beyond general attitudes and quality perceptions to observe actual interactions in academic contexts. This gap motivates our study, which directly observes how students use ChatGPT in academic writing to understand their interaction patterns and implications for learning.

# 3 Method

To understand the usage patterns students have with ChatGPT, we conducted an online study designed to capture these patterns and examine their relationship with other factors: the students' background, the resulting essay, and their perceptions towards AI. We introduce the system developed for data collection and outline the methodological approach used for our qualitative and quantitative analyses.

## 3.1 Instrument Development: Writing Platform + ChatGPT Development

To understand how students use ChatGPT, we developed a platform that tracked their queries and the corresponding responses. Since ChatGPT is an independent app, we built a system that integrates an in-house ChatGPT -referred to simply as ChatGPT from this point -within the writing platform, using the default OpenAI API (model 3.5-turbo) to record user interactions. This tool enabled us to collect three types of data: students' queries to ChatGPT, ChatGPT's responses, and keystroke-level recordings of their writing process, which allowed us to analyze how students incorporated ChatGPT responses into their essays. Our application has two main features: a plain text editor for essay writing and access to ChatGPT. The web application emulates ChatGPT's functionality to replicate its experience as closely as possible.

The fi rst tab (Figure 2) of our application is a writing platform where participants were asked to respond to an essay prompt in the text editor. The editor recorded all input operations and their sequence, including insertions, deletions, text selection, copy, cut, and paste events. We also recorded the timestamps of each operation to determine when each edit was made. With this, we were able to observe and analyze participants' writing processes, using timestamps to track how they alternated between the editor and the in-house ChatGPT and how they integrated ChatGPT responses into their writing (e.g., pasted text). This data was sent to a server as it was generated, and these features were implemented using the CodeMirror 5 API and the CodeMirror-Record fi les [[59, Jisuake 2023, CodeMirror Record](#ref-59)].

To track how users interact with ChatGPT, we implemented a custom version of ChatGPT using the OpenAI API, as shown in Figure 3. We chose to simulate browser tabs to give participants the impression that ChatGPT was available to them in a separate window, requiring them to switch tabs if they wanted to use it. This design choice mirrors practical usage, as opposed to displaying ChatGPT side by side with the writing platform, which could artificially encourage their use. Participants were allowed to ask any questions to ChatGPT, and we did not pre-prompt the system (e.g., assigning it the role of a writing assistant) so that its behavior would closely resemble the standard ChatGPT experience. We also allow for copy/paste events between each window, allowing participants to bring information between both tabs. We recorded all queries and their timestamps to analyze how and when ChatGPT was prompted for assistance during the writing process.

## 3.2 Study Procedure

Before writing an essay, we asked participants to complete a prestudy survey created in QuestionPro to collect basic demographic information. The survey also included two standard questionnaires: the Technology Acceptance Model (TAM) [[31, Davis 1989, Perceived Usefulness](#ref-31)], which we adapted for ChatGPT, and a Self-Efficacy for Writing (SEWS) questionnaire [[17, Bruning et al. 2013, Dimensions of Self-Efficacy](#ref-17)]. This questionaire is shown in Appendix A.1.

The Technology Acceptance Model (TAM) is a well-established framework used to understand how users come to accept and use technology. TAM has two subscales: (1) perceived usefulness of technology (TAM PU), which refers to the degree to which a person believes that using a particular technology will enhance their job performance or improve productivity, and (2) perceived ease of use (TAM PEOU), which reflects how easy a technology is to use, based on the idea that users are more likely to accept a technology if they fi nd it easy to operate. The Self-Efficacy for Writing Scale (SEWS) measures students' confidence in their writing abilities across different tasks and contexts. This construct is grounded in influential motivation and writing theories and also accounts for behaviors such as help-seeking. Students with lower self-efficacy may be more inclined to use tools such as ChatGPT to reduce the cognitive load [[17, Bruning et al. 2013, Dimensions of Self-Efficacy](#ref-17); [110, Woodrow 2011, College English Writing Affect](#ref-110)]. Together, these two constructs provide complementary insights: SEWS reflects internal beliefs about writing competency, while TAM captures perceptions of the tool itself. By incorporating both, we examine which factors can serve as predictors of GenAI usage, accounting for how students may or may not use ChatGPT in their writing.

The participants were then redirected to our writing-ChatGPT platform to begin the essay task. We used a sample writing prompt from the American College Testing (ACT), as most college students applying to US universities are familiar with this type of assignment. The prompt addressed the issue of automation replacing humans with machines and included three perspectives on the topic. Participants were asked to present their own perspective and analyze how it relates to at least one of the perspectives provided (shown in Figure 2). The complete prompt is included in Appendix A.2. We asked participants to spend approximately 30 minutes on the essay, as the ACT exam allows a maximum of 40 minutes for the essay response. During the study, they were neither encouraged nor discouraged from using ChatGPT. The study was advertised as 'a study investigating essay writing and ChatGPT." On the interface, the participants were instructed: 'If you wish to use ChatGPT, please click the ChatGPT tab and ask questions. Do not use ChatGPT in your browser; use the one we provided." They were further instructed to write the essay as if it were 'a class assignment that would be submitted for a grade." We did not impose any policy restricting ChatGPT usage, allowing participants full autonomy in deciding whether and how to use the tool.

![Figure 2](images/figure-2.png)

> **Figure 2:** The editor view of the website


After submitting their essays, participants completed two additional questionnaires to reflect on their writing experience. First, we sought to determine whether students felt the essay was truly 'theirs" and whether reliance on ChatGPT influenced that perception. To measure perceived ownership (PO) of the written artifact, we used a validated questionnaire [[7, Avey et al. 2009, Psychological Ownership](#ref-7); [23, Chantal 2012, Psychological Ownership](#ref-23); [101, Vandewalle et al. 1995, Psychological Ownership](#ref-101)]. Second, we used the Creativity Support Index (CSI) to assess how well ChatGPT supported their creativity [[26, Cherry & Latulipe 2014, Creativity Support Index](#ref-26)]. From CSI, we took the Collaboration subscale questions out as this scenario does not involve any collaboration with others. These measures provide insight into students' perceptions of ChatGPT in the context of academic writing.

## 3.3 Recruitment

For recruitment, we posted our survey on various university mailing lists, targeting both undergraduate and graduate students. In addition, we recruited participants through Prolific, an online crowdsourcing platform, with the screening criterion of being a college student in the United States. All participants were entered into a raffle for the chance to win a $10 gift card, with a winning odds of 1 in 5. In total, we recruited 77 participants. For participants' ages, we used the following age bands: 18-24 (n=62), 25-34 (n=10), 35-44 (n=2), 45-54 (n=1), 55-64 (2). Of the 77 participants, 34 identified as women, 1 as nonbinary, and 32 as men. The racial distribution was as follows: 37 White/Caucasian, 24 Asian/Pacific Islander, 7 Black or African American, 5 Hispanic, and 4 Other.

## 3.4 Qualitative Analysis of ChatGPT Queries

To analyze the queries sent to ChatGPT, we coded all participant queries into categories inspired by Flower and Hayes' Cognitive Process Theory of Writing [[39, Flower & Hayes 1981, Cognitive Process Theory](#ref-39)]. In this study, we treat the queries that

![Figure 3](images/figure-3.png)

> **Figure 3:** The screencapture of the in-house ChatGPT provided to participants


students submit to ChatGPT as an alternative source of think-aloud data, as these queries manifest their ongoing cognitive processes. While ChatGPT cannot gather all of the data a true think-aloud study can, this approach captures authentic student usage and explores how cognitive processes across writing phases vary with individual characteristics. In addition, having independent coders categorize each query based on its semantic content mirrors the real-world practice in which instructors must assess the nature and severity of GenAI use from the questions students ask, rather than relying on students to articulate their underlying intentions.

In the following subsections, we provide a detailed description of each category and outline the subcategories that have been identified within it. Coding and categorization were performed independently by two authors, followed by multiple discussion sessions to reach agreement (Cohens κ = . 89; see subsubsection 3.4.5).

### 3.4.1 Planning (P)

According to Flower and Hayes's model, the goal of Planning is defined as ' to take information from the task environment and from long-term memory and to use it to set goals and to establish a writing plan to guide the production of a text that will meet those goals ' [[39, Flower & Hayes 1981, Cognitive Process Theory](#ref-39)]. Main activities within planning

include collecting information, generating and organizing ideas, setting goals or outlining the writing structure [[39, Flower & Hayes 1981, Cognitive Process Theory](#ref-39)]. This category, therefore, included queries such as asking for examples, seeking information, or requesting help in structuring the essay. Any query explicitly asking ChatGPT to generate essay text or write portions of the essay were not identified as planning and classified into a different category.

### 3.4.2 Translating (T)

The second category derived from the model is Translating , defined as the process of turning ideas into text [[39, Flower & Hayes 1981, Cognitive Process Theory](#ref-39)]. Queries were classified as translating when they included both a request to generate text for the essay and sufficient context about the desired content. Requests to generate portions of the essay larger than a paragraph were excluded from this category and instead classified into the All category, as this includes planning and reviewing activities.

### 3.4.3 Reviewing (R)

The Reviewing category included any query that asked for evaluations or revisions of existing text, aligning with the two subprocesses of reviewing in Flower and Hayes' model [[39, Flower & Hayes 1981, Cognitive Process Theory](#ref-39)].

![Figure 4](images/figure-4.png)

> **Figure 4:** Data Flow Diagram between Editor, Participant, and ChatGPT


Queries involving evaluation ranged from seeking targeted feedback on written text to requesting a score or grade. Queries involving revision included requests to fi x simple spelling and grammar errors, as well as more complex tasks, such as rewriting sections of an essay in a particular style. In other words, any query in which participants supplied original text and requested an evaluation or rewrite-without significantly altering the overall theme or viewpoint-was classified as Reviewing .

### 3.4.4 All (A)

The All category corresponded to using ChatGPT to make a request that involves all three activities, Planning, Translating, and Reviewing, to ChatGPT. Such queries involve generating the entire essay or a portion of it (e.g., a paragraph).

Finally, not all queries fi t the four main categories. Some were unrelated to the writing task, as there were no constraints on the types of queries that participants could submit. For example, we identified a code for providing feedback , where a participant evaluated ChatGPT's response and offered feedback (e.g., typing 'That's a great idea.'), which is not tied to any specific process of writing. We do not discuss these types of messages in this paper, as our focus is on writing-related queries.

### 3.4.5 Inter-rater Reliability

To validate our qualitative coding results, two researchers independently categorized each ChatGPT query using our coding framework (P, T, R, A). Our analysis involved categorical classification into four distinct codes, and the resulting Cohen Kappa score ( κ = . 89) indicates strong inter-rater agreement [[78, McHugh 2012, Interrater Reliability](#ref-78)], demonstrating both the clarity and consistency of our codebook definitions and supporting the validity of the subsequent quantitative analysis based on the four categories.

### 3.4.6 Finer-grained Coding

In addition to the four categories above, we coded each query using a fi ner-grained codebook that we developed in an inductive manner. These codes were defined within one of the four process categories, so for example, the code Proofread (RE01 in Table 3) falls under the Reviewing category. Two authors of the paper started out developing the codebook independently, then met to compare their coding schemes and revise them through discussion until they reached agreement. The fi ner-grained codes for each category are presented in the Results section (Tables 1, 2, 3, and 4). The authors assigned a code based on the semantic meaning of the query itself, rather than the latent intention that can be inferred from subsequent actions (e.g., how the generated text was used afterwards), thereby minimizing the subjectivity of coders in the coding process.

## 3.5 Quantitative Analysis

### 3.5.1 Essay Writing Trace

The recording features tracked each user's input and stored it in our database with timestamps. In general, it provided comprehensive keystroke-level data capable of reproducing each writer's writing process and interactions with ChatGPT. Figure 4 illustrates the overall data fl ow in terms of word count. For example, we examined how ChatGPT responses contributed to the writing process by comparing the generated responses with the text participants pasted into the editor afterward, represented as 'Pasted ChatGPT words' in Figure 4. The following list provides examples of metrics calculated for each participant:

- Number of queries made (per category: P, T, R, A) for the essay (Figure 4-( 3 ) )
- Number of words manually entered (Figure 4-( 1 ) )
- Number of words copy-pasted from ChatGPT into the essay (per query category: P, T, R, A) (Figure 4-( 5 ) )
- Number and word count of Copy/Cut/Paste events in the Editor, Prompt, or ChatGPT query textbox
- Final number of ChatGPT-generated words in the essay (Figure 4-[ ( 5 ) -( 6 ) ])
- Final number of participant-written words in the essay (Figure 4-[ ( 1 ) -( 2 ) ])

We used these metrics to gain insight into how users interact with GenAI and how their use relates to other constructs 1 .

### 3.5.2 Data Analysis for RQ2

For RQ2, we examined whether an individual's background, including Self-Efficacy for Writing (SEWS) and Technology Acceptance Model (TAM) scores, could predict ChatGPT usage. We ran a generalized linear model (GLM) using the glm function in R. A Poisson model was chosen because the predicted values were counts (e.g., the number of ChatGPT queries or the number of words written by a participant). For example, the relationship between the predictors and the expected count of ChatGPT queries ( μ i ) for participant ( i ) can be expressed as follows:

![Figure 5](images/figure-5.png)

> **Figure 5:** The query count for each category and the number of participants who used such a query


<!-- formula-not-decoded -->

where:

- Gender i = 1 for Men, 0 otherwise
- Race i = 1 for White, 0 otherwise
- Age i = 0 for ages 18-24, 1 for 25-34, 2 for 35-44, 3 for 45-54, 4 for 55 or older

The model uses a log-link function to relate the expected query count for each type (P, T, R, A, and their total) per essay to the predictor variables.

### 3.5.3 Readability scores for RQ3

Additionally, we looked at the complexity of the essays using readability scoring. We chose to use both the Flesch-Kincaid Grade Level and Dale-Chall Readability Score. The Flesch-Kincaid Grade Level is one of the more commonly used metrics, estimating the U.S. grade level required to comprehend the text, with higher scores indicating greater complexity [[38, Flesch 1948, Readability Yardstick](#ref-38); [62, Klare 2000, Measurement of Readability](#ref-62)]. The Flesch-Kincaid metric uses average sentence length and syllable count per word to determine text complexity [[38, Flesch 1948, Readability Yardstick](#ref-38)]. We also used the Dale-Chall Score as it has been found to be more accurate than other readability metrics, including FleschKincaid [[62, Klare 2000, Measurement of Readability](#ref-62)]. The Dale-Chall Score evaluates readability based on sentence length and word difficulty [[30, Dale & Chall 1948, Predicting Readability](#ref-30)], complementing the FleschKincaid Grade Level by using a vocabulary-based assessment to capture semantic complexity.

# 4 Results

## 4.1 RQ1: Understanding Students' ChatGPT Queries for Essay Writing

In understanding how students' ChatGPT usage fi t within their writing processes, we analyzed the queries they sent to ChatGPT. As discussed in 3.4, we grouped queries into four main categoriesPlanning, Translating, Reviewing, and All-developing fi ner-grained codes for a more detailed analysis.

In total, participants sent 361 messages to ChatGPT, and we identified 26 unique codes. Of these, 320 messages fell into one of the four main categories. Figure 5 shows the number of query messages that were categorized into each type and the number of participants who had such a query at least once.

Messages that were not categorized (41) were typically incomplete and excluded to avoid redundant counting. For example, a participant might ask ChatGPT to review their essay without pasting the text, followed by a repaired query that included it; in such cases, only the repaired query was categorized. A small subset of miscellaneous codes (Greeting, Appreciation, Jokes, and Clarifying ChatGPT's capability) were identified but are not discussed in this paper. With this coding scheme, we identify how the different processes of writing appear in the queries to ChatGPT, presenting frequency and subcategories describing how the process appeared in participant queries. Below, we present the codes within each category.

### 4.1.1 Planning

Planning queries refer to the process of ideating and deciding what to write, often occurring in the early stages of writing. Nearly half of the participants (35/77) used at least one Planning query while writing their essays. Among these participants, the average frequency was more than two queries each, and we observed diverse uses of ChatGPT related to Planning.

> **Table 1:** Planning Query Types

| Code   | What did they ask ChatGPT to do?                |   Count | Participants (%)   |
|--------|-------------------------------------------------|---------|--------------------|
| PL01   | Provide an answer to a ques- tion on a topic    |      20 | 12 (15.6%)         |
| PL02   | Provide examples                                |      16 | 12 (15.6%)         |
| PL03   | Search for factual informa- tion                |      18 | 8 (10.4%)          |
| PL04   | Suggest an essay structure                      |      10 | 7 (9.1%)           |
| PL05   | Expand on an existing idea                      |       7 | 7 (9.1%)           |
| PL06   | Recommend topics to write about                 |       5 | 4 (5.2%)           |
| PL07   | Help interpret the writing prompt               |       4 | 4 (5.2%)           |
| PL08   | Compare the essay to an al- ternative viewpoint |       3 | 2 (2.6%)           |

The most common type of Planning query involved using ChatGPT as a tool for topic research, particularly for requesting examples (PL02) or retrieving factual information such as statistics (PL03). Examples of this type of query are provided below.

- P49: Can you provide examples for a machine doing better at a task than a human would? (PL02)
- P75: average unemployment rate in the 2000s (PL02)

In this case, the students used ChatGPT much like an online search engine. At times, answers (e.g. statistics) were not provided because the model powering the in-house ChatGPT did not have web search functionality, and it refused to answer based on hallucination. However, when an answer was generated, it was often more convenient than using a traditional search engine, as participants did not need to navigate multiple result pages or collect information before selecting what to use in their essays.

Another common type of query involved simply asking a question related to a topic or taking writing suggestions (PL01, PL05, PL06 in Table 1). In these cases, the queries resembled asking someone for their opinions rather than searching for information. Examples in this category are as follows:

- P20: Give me reasons why automation is actually good for society to be able to progress (PL01)
- P36: Automation is generally seen as a sign of progress, but what is lost when we replace humans with machines? [copied from the prompt] (PL01)
- P54: read this information about an issue and give some ideas for an essay I am going to write about it. [pasted writing prompt] (PL06)

Although this type of question does not explicitly ask ChatGPT to write the essay, it replaces the process through which a student might otherwise critically engage with the topic via contemplation or research. While P20 at least appeared to select one of the three perspectives provided in the prompt, P36 and P54 did not generate any questions or ideas of their own. Specifically, P36's query was a direct copy-and-paste of the writing prompt, and P54 explicitly asked ChatGPT to suggest ideas for what to write about.

Finally, rather than asking about the essay topic itself, some participants asked questions about how to structure the essay (PL04). Even when students have an idea of what to write about, arranging and organizing those ideas into a coherent narrative is a critical aspect of writing, as it shapes how effectively the overall topic is conveyed to readers. Relying on ChatGPT for this step can represent a missed opportunity to develop one's own writing expertise [[11, Bereiter & Scardamalia 2013, Psychology of Written Composition](#ref-11)].

Overall, using Planning queries with ChatGPT replaced essential aspects of writing, such as forming an opinion on a topic, conducting research, and determining the overall direction of the essay (e.g., logic, fl ow, structure).

### 4.1.2 Translating

Translating is a crucial process of the writing process that shapes the overall quality and rhetoric of an essay beyond its core ideas, influencing aspects such as tone, coherence, and persuasiveness [[39, Flower & Hayes 1981, Cognitive Process Theory](#ref-39)]. We labeled a participant query as Translating when the participant provided an idea and/or surrounding text from which the idea could be inferred and asked ChatGPT to generate text that they were going to use for writing; these queries primarily reflect generating text based on the given idea (shown in Table 2). Only 10 participants used ChatGPT to support the translation process of writing, making it the least common query type in our dataset.

> **Table 2:** Translating Query Types

| Code   | What did they ask ChatGPT to do?           |   Count | Participants (%)   |
|--------|--------------------------------------------|---------|--------------------|
| TR01   | Write a paragraph given an idea            |       9 | 7 (9.1%)           |
| TR02   | Complete incomplete para- graphs/sentences |      10 | 6 (7.8%)           |
| TR03   | Write a sentence given an idea             |       3 | 3 (3.9%)           |
| TR04   | Suggest expression/word choice             |       5 | 2 (2.6%)           |

The most common type of Translating query occurred when participants asked ChatGPT to write a paragraph (TR01) or a sentence (TR03) based on an idea they provided, a pattern observed with seven participants.

- P04: Write a fi nal intro sentence that explains what this paper is trying to do: aka 'this paper claims that ai is good because it exposes our inefficiencies' but in a few sentences. (TR01)
- P58: [A paragraph pasted] make this paragraph stronger. (TR01)

In both examples, participants provided a specific idea they wanted to write about but relied on ChatGPT to generate and/or strengthen the paragraph.

Another interesting pattern we observed was the participants providing an incomplete sentence or paragraph and asking ChatGPT to complete it (TR02). The following query exemplifies this pattern well.

- P04: I need my fi rst intro sentence and I've got a start: 'Another way automation, especially AI, is a good thing to help us expose our own inefficiencies is ' But I don't know how to fi nish it (TR02)

- P15: As human beings, we strive to continue progressing toward a better future. Automation has been at the forefront of (TR02)

In P15's case, a clear prompt was missing; the participant expected ChatGPT to complete an unfinished sentence, and the model returned an entire essay continuing from that fragment, although P15 only used one sentence from it. One could argue that the participant did not provide a clear idea of what to write next and that this case should have been categorized under the All category. However, since a seed idea was present and the cues from the incomplete sentence guided the direction of the essay, we interpreted it as the participant's rough idea of what the generated text should be.

In general, Translating queries were not common, suggesting that when participants wanted to generate text, they typically did not separate the task into two distinct queries, Planning and Translating. Alternatively, this may indicate that when participants had an idea of what to write-either on their own or derived from a Planning query-they were generally willing to write independently.

### 4.1.3 Reviewing

For the Reviewing type of ChatGPT queries, 34 out of 77 participants submitted at least one. These queries typically included the written essay as part of the input. The most common code was Proofreading (RE01), where participants asked ChatGPT to refine, polish, or proofread their work. Examples of Proofreading queries are presented below.

> **Table 3:** Reviewing Query Types

| Code   | What did they ask ChatGPT to do?               |   Count | Participants (%)   |
|--------|------------------------------------------------|---------|--------------------|
| RE01   | Proofread                                      |      27 | 16 (20.8%)         |
| RE02   | Answer spelling/grammar questions              |      13 | 10 (13.0%)         |
| RE03   | Give feedback                                  |      19 | 7 (9.1%)           |
| RE04   | Shorten text/remove some content               |       8 | 7 (9.1%)           |
| RE05   | Rewrite existing text based on a user's prompt |      11 | 6 (7.8%)           |
| RE06   | Improve the essay                              |       8 | 6 (7.8%)           |
| RE07   | Check if the essay meets the prompt            |       4 | 3 (3.9%)           |

- P03: Check the essay for inaccurate or unclear statements (RE01)
- P27: Review this essay and make recommendations for grammar, spelling, punctuation and clarity of thought (RE01)

In addition to proofreading, participants sometimes asked about specific word spellings or grammar, for example, ' how to spell sophisticated [sic] (P60)' or ' is 'extremely faster' correct? (P63).'

Another common type of Reviewing was asking ChatGPT to provide feedback and evaluate the essay (RE03, RE07). Once an essay was written, some participants asked ChatGPT to give feedback on it or even to grade it as if it were an assignment. Seven participants requested general feedback on the content of their essays, with examples presented below:

- P04: Here's our fi rst paragraph now expanding on my opinion, thoughts? [a paragraph text] (RE03)
- P06: Now as the teacher of the class, grade this essay based on if the essay meets this: state your own perspective on the issue, and analyze the relationship between your perspective and at least one other perspective on the issue. Grade the essay out of 100. (RE03)

This type of query corresponds to evaluation, which, along with revision, is one of the two components of the Reviewing process in Flower and Hayes' model. However, it should be noted that participants made little effort to specify how ChatGPT should evaluate the essay (e.g., in terms of content, organization, or clarity) beyond simply including the writing prompt. Rather, a couple of evaluations ask ChatGPT to explicitly grade the essay (e.g. 'Grade the essay out of 100' , P06), which we can see as their goal-oriented attitude.

Lastly, several participants asked ChatGPT to revise or rewrite a paragraph in some way. We did not categorize these queries as Translating, since participants provided existing text and did not explicitly request changes to the underlying ideas; such cases were categorized as All queries. Instead, these requests focused on altering the writing style (RE05), shortening or removing text (RE04), or improving overall quality (RE06).

- P26: I think your revisions are good, but I think my original paragraph had more of a human touch to it. Do you think you can add that human touch back in to your revision? (RE05)
- P65: how can the following essay be improved [essay pasted] (RE06)
- P65: Make this sound more professional: [a paragraph pasted] (RE06)

In these examples, the participants delegated the revision task to ChatGPT. However, they at least evaluated the essay themselves and determined that the current version was insufficient, prompting them to seek improvements in specific ways.

### 4.1.4 All

The All category was used when the participants made a query that involved assistance spanning all three processes of writing. More than 50% of participants used at least one All query, with a total of 137 such queries, an average of 3.3 per person among those who used them. All queries were the most common query type overall.

> **Table 4:** All Query Types

| Code   | What did they ask ChatGPT to do?                          |   Count | Participants (%)   |
|--------|-----------------------------------------------------------|---------|--------------------|
| AL01   | Generate an essay entirely                                |      20 | 20 (26.0%)         |
| AL02   | Write conclusion                                          |      13 | 13 (16.9%)         |
| AL03   | Generate an alternative es- say with some feedback        |      29 | 12 (15.6%)         |
| AL04   | Generate a portion of an es- say given a high-level idea  |      23 | 11 (14.3%)         |
| AL05   | Generate the entire essay given a high-level idea         |      15 | 8 (10.4%)          |
| AL06   | Shorten/Lengthen the gen- erated text from the re- sponse |      17 | 7 (9.1%)           |
| AL07   | Write introduction                                        |       6 | 4 (5.2%)           |

20 participants simply asked ChatGPT to generate an entire essay (AL01), making this the most frequently used code among all query types. In most cases, they copied and pasted the essay prompt with little additional input reflecting their own thoughts. This type of query was often the fi rst one issued to ChatGPT, meaning that many participants began the writing process with a draft already generated by the system.

Some participants provided additional context on what they wanted in the essay, often adding a few sentences to express their opinion on the issue (AL05). A few examples of a participant adding their opinion are shown below:

- P77: Pretend you are a college student who needs to write an essay on your perspective on the use of machines and artificial intelligence in society. You believe that progress is generally a good thing, but we should be wary of the dangers of overreliance. This is the prompt: [Pasted the writing prompt that contains three perspectives] (AL05)
- P24: Issue is about Automation and how humans can being [sic] replaced with machinery. Write an essay about how it could affect humanity in a dystopian view (AL05)

In these examples, the choice of one perspective among the three provided in the prompt was included as part of the query (AL04). This pattern of giving high-level direction was often used for the generation of smaller portions of the essay (e.g., a few paragraphs). A similar pattern was observed in other common queries, such as requesting an introduction (AL07) or a conclusion (AL02). When given a body of text, whether written by themselves or by ChatGPT, participants frequently asked the system to generate a missing paragraph without providing clear instructions.

Another common pattern was when a participant read what ChatGPT generated and then asked it to rewrite the text after providing some feedback. This process involved evaluating the generated essay and identifying areas for revision. Sometimes, the requested revision focused on length (AL06), but more often, participants provided specific feedback for ChatGPT to incorporate (AL03). Here are some examples:

- P20: dont include self driving cars, give another good example that involves a readily applicaiton [sic] used by people daily. like Siri by Apple (AL03)
- P05: rewrite in college level (AL03)
- P61: make it souund intelligvent [sic]. and make it long (AL03, AL06)

As seen in the examples, we did not categorize these as Translating or Reviewing queries because (1) the provided ideas were not concrete enough to guide what ChatGPT would generate, and (2) the essay they asked to revise had also been generated by ChatGPT. Overall, the result showed that when students were in a situation where their ChatGPT usage was not regulated, they used it to conveniently generate the entire essay.

### 4.1.5 Vibe Writing: Writing with the agent

One notable pattern we observed was that some participants used ChatGPT to generate most or all of the text for their essay while steering the output with higher-level feedback and prompts.

For example, participants could write an entire essay through ChatGPT interactions without typing a single word in the editor, simply by pasting what the system generated; 15 participants (19.5%) submitted essays that were 100% written by ChatGPT. This pattern parallels Vibe Coding [[88, Sarkar & Drosos 2025, Vibe Coding](#ref-88)], where a programmer collaborates with AI to produce code aligned with their intended specification. We refer to this mode as Vibe Writing and present it in this section.

Vibe writing does not necessarily mean it only contains queries in All categories; it can involve some queries that are classified as Planning, Translating, or Reviewing.

For example, text generated from Planning queries-intended to provide ideas-was sometimes used directly in the fi nal essay, as they could copy and paste text from the generated response. In fact, participants copied and pasted responses from Planning queries a total of 14 times, across seven individuals. This behavior suggests that even when writers asked ChatGPT for ideas or information, the generated text was often copied and pasted directly into their final essays, possibly diverging from their original intention.

Using a Reviewing query also did not necessarily mean that participants revised their own writing with ChatGPT. A preceding query could have generated text based on an All-type query. For example, P74's essay is a clear example of Vibe Writing mode: the participant produced a 641-word essay, 87.1% of which was written by ChatGPT across 11 queries. The following two examples illustrate the types of queries that P74 used.

- P74: First, let's say 'a' perspective instead of 'the' perspective. Second, I don't see any lines that hint at the unique perspective of the author, it's just an overview of the other two perspectives. Let's add something like: 'A lot of labor in today's world involves tasks that don't necessarily require human levels of intelligence to complete, because the end product is well defined. A utilitarian perspective on automation acknowledges this.... ' Also you could be a bit more detailed in your ideas-just act like you're a 1900s sci-fi writer or someone who would have thought about this enough.
- P74: That conclusion is a bit too whimsical! Channel your inner science journal.

One might argue that using Planning, Translating, and Reviewing queries is seemingly less problematic than relying on All queries. However, in practice, participants often interacted with ChatGPT to generate ideas, produce text, and revise it by prompting only, effectively authoring an essay in the mode of Vibe Writing.

The result shows the complexity of understanding the impact of GenAI on students' learning; it is necessary to look beyond the types of queries they made. Based on our fi ndings, multiple components need to be considered: how GenAI responded to a query, how a student integrated the generated text into their writing, what kinds of text were used in the query and where that text originated, and the overall history of queries, responses, and copied text.

### 4.1.6 Clustering Participants by ChatGPT Usage Patterns .

For further analysis of each research question, we clustered participants based on the similarity of their usage patterns. We employed K-means clustering to identify underlying patterns in student use of ChatGPT by grouping participants according to the distribution of their query types. This unsupervised machine learning approach enabled data-driven classification and provided deeper insight into distinct usage behaviors across groups and how different usage patterns affect their experiences (e.g., Perceived Ownership in RQ4).

> **Table 5:** Query count and query-type distribution (%) per group. We bold the primary query type when its average proportion is greater than, or approximately equal to, half of the total.

|             | Group Statistics   | Group Statistics   | Proportion of Query Distribution%   | Proportion of Query Distribution%   | Proportion of Query Distribution%   | Proportion of Query Distribution%   |
|-------------|--------------------|--------------------|-------------------------------------|-------------------------------------|-------------------------------------|-------------------------------------|
| Group       | Size               | Query Count (SD)   | Planning                            | Translating                         | Reviewing                           | All                                 |
| No Query    | 6                  | 0 (0)              | 0                                   | 0                                   | 0                                   | 0                                   |
| Planning    | 16                 | 2.62 (1.96)        | 93.0%                               | 2.1%                                | 1.3%                                | 3.6%                                |
| Translating | 5                  | 4.8 (2.17)         | 5.0%                                | 48.5%                               | 29.5%                               | 17.0%                               |
| Reviewing   | 9                  | 3.33 (3.16)        | 4.4%                                | 3.7%                                | 88.1%                               | 3.7%                                |
| All         | 25                 | 5.28 (6.09)        | 0.9%                                | 0.4%                                | 3.5%                                | 95.1%                               |
| Mixed       | 16                 | 7.44 (6.3)         | 33.2%                               | 3.1%                                | 37.6%                               | 26.1%                               |

![Figure 6](images/figure-6.png)

> **Figure 6:** Query distribution per group


Each participant was represented by a 4-dimensional feature vector, where each component corresponded to the percentage of P, T, R, and A query types out of all queries they submitted. For example, if a participant asked one planning query and three reviewing queries, their feature vector would be [ 0 . 25 , 0 , 0 . 75 , 0 ] . Participants who did not ask any questions were represented with a zero vector.

Using these feature vectors, we grouped participants by their primary ChatGPT usage. Based on the sum of squared error (SSE) scores (shown in Appendix 12a), we applied the elbow method [[100, Thorndike 1953, Who Belongs in the Family](#ref-100)] and determined that K = 6 was appropriate. These clusters were visually inspected based on the query type distribution and named according to defining characteristics:

- Group No Query (N) : Participants who did not use ChatGPT for the task ( n = 6).
- Group Planning (P) : Participants whose ChatGPT queries were primarily focused on Planning activities ( n = 16).
- Group Translating (T) : Participants whose ChatGPT queries were primarily focused on Translating activities ( n = 5). This group's participants also contain very low Planning queries.
- Group Reviewing (R) : Participants whose ChatGPT queries were primarily focused on Reviewing activities ( n = 9).
- Group All (A) : Participants whose ChatGPT queries were primarily focused on All activities ( n = 25).
- Group Mixed (M) : Participants with mixed behaviors, whose ChatGPT queries were distributed across multiple categories ( n = 16). The participants in this group used few Translating queries.

The average distribution of each query type per group is presented in Table 5.

Using these groups, we tested whether there were significant differences in the metrics examined in RQ3 and RQ4 based on group membership. Because none of the metrics met the assumption of normality (e.g., average values of ordinal outcomes), we used the Kruskal-Wallis test. For post hoc analysis, we used Dunn tests with Bonferroni correction to identify significant groupings.

![](images/image-1.png)

(a) Transition matrix for the queries. Each cell shows the probability of transitioning to a state (column) given the current state (row). The number in parentheses indicates the number of times the transition was observed, normalized to the total number of queries made by each participant.

![Figure 7](images/figure-7.png)

*(b) State diagram representing the transition matrix. Node size reflects the total number of queries, and edge width is proportional to the number of transitions. This diagram displays only the 9 most frequent edges where the number of transitions accounts for 80% of the entire transitions.*

> **Figure 7:** Transition matrix and state diagram for ChatGPT queries. The leftmost graph is the tranistion matrix heatmap, while the right shows the state diagram.



### 4.1.7 Interaction Patterns and Writing Stage Transitions .

We examined how many times each participant asked questions to ChatGPT to show the distribution of query counts, as shown in Figure 6a. Overall, nearly half of the participants (39 out of 77) used ChatGPT less than or equal to twice; six participants, classified as Group N, never used it at all. Meanwhile, some participants used ChatGPT multiple times, with one participant submitting 27 queries, the highest count observed. We analyzed the number of queries submitted by each group using a box plot (Figure 6b), but we did not fi nd statistically significant differences between our ChatGPTusing groups except for Group No Query, which differed from all other groups. Based on the proportion of GPT-generated words, participants who wrote in Vibe Writing mode are more likely to belong to Group A and Group M, given the significantly higher shares of GPT-produced text in their fi nal essays.

We analyzed the sequence of query types by constructing a transition matrix and visualizing the typical order of interactions through a state diagram. A transition probability in the matrix (Figure 7a) represents the likelihood of a participant asking a particular type of query given their current state. We also report the normalized counts of each transition, shown in parentheses in Figure 7a. To account for individual differences in the total number of queries and to avoid over-weighting participants who asked many queries, transition counts were normalized by dividing each by the total number of transitions per participant. Using these normalized counts, we generated a state diagram in Figure 7b that highlights transition paths representing 80% of all transitions, thereby revealing the common sequence participants followed.

The state diagram reveals four common paths among participants. The fi rst is Start → Planning (+) → End, where the plus sign ( + ) indicates that the state can be repeated multiple times. Participants on this path asked only Planning questions before completing their essays. The second path is Start → Reviewing → End, where participants used ChatGPT solely to review their writing before fi nishing the essay. The third path, Start → All (+) → End, represents participants who asked ChatGPT to generate content that could be directly incorporated into their essays, categorized as All . Finally, some participants did not use ChatGPT at all (Start → End). These four paths correspond to four of the six identified groups: Group P, Group R, Group A, and Group N, respectively.

Our analysis of ChatGPT queries revealed several key results: the common types of queries and illustrative examples categorized under the framework of Planning, Translating, Reviewing, and All; the identification of a distinctive 'Vibe Writing' mode of interaction; and the common sequences in which participants used ChatGPT during the essay writing task.

## 4.2 RQ2: The Relationship Between ChatGPT Usage and Participant Perception Towards Their Writing Efficacy and Technology Acceptance

For RQ2, we aimed to discover if certain student characteristics might influence their ChatGPT usage patterns. For student characteristics, we collected demographic information along with two Note:

> **Table 6:** Generalized Linear Model for Total Query and Query Counts by Code

|               | Total Queries       | Planning Queries   | Translating Queries   | Reviewing Queries   | All Queries        |
|---------------|---------------------|--------------------|-----------------------|---------------------|--------------------|
| Self-Efficacy | - 0.258 ∗∗∗ (0.075) | - 0.204 (0.147)    | - 0.949 ∗∗ (0.307)    | - 0.588 ∗∗∗ (0.154) | - 0.016 (0.114)    |
| TAM PU        | 0.048 (0.062)       | 0.122 (0.131)      | - 0.384 (0.208)       | - 0.205 ∗ (0.103)   | 0.282 ∗∗ (0.106)   |
| TAM PEOU      | - 0.087 (0.066)     | 0.007 (0.141)      | - 0.025 (0.215)       | 0.051 (0.119)       | - 0.277 ∗∗ (0.103) |
| Gender (Male) | 0.308 ∗ (0.125)     | 0.361 (0.252)      | 0.064 (0.455)         | 0.712 ∗∗ (0.270)    | 0.030 (0.185)      |
| Age           | - 0.038 ∗∗ (0.013)  | - 0.006 (0.021)    | - 0.041 (0.044)       | - 0.002 (0.021)     | - 0.127 ∗∗ (0.040) |
| Race (White)  | 0.373 ∗∗ (0.117)    | 0.191 (0.234)      | 0.351 (0.435)         | 0.946 ∗∗∗ (0.246)   | 0.199 (0.178)      |
| Constant      | 3.534 ∗∗∗ (0.581)   | 0.262 (1.064)      | 6.679 ∗∗ (2.546)      | 3.064 ∗∗ (1.154)    | 3.359 ∗∗ (1.149)   |

constructs we measured before the study: the Self-Efficacy in Writing Scale (SEWS) and the Technology Acceptance Model (TAM).

We ran a generalized linear model (GLM) to analyze the relationships between multiple predictor variables and different query types simultaneously. Table 6 presents the full results, including the estimated coefficients and their significance levels. The sign of each coefficient indicates the direction of the relationship, with positive values reflecting a positive association and negative values indicating a negative association.

SEWS and ChatGPT usage showed a statistically significant negative relationship between total query counts and Translating and Reviewing queries. This result suggests two notable patterns. First, self-efficacy in writing is a significant predictor of ChatGPT use: participants with lower writing self-efficacy tended to use ChatGPT more frequently. Second, this negative relationship was largely accounted for by Translating and Reviewing queries-both closely tied to the writing stage-while no such effect was observed for ideation-related query types (Planning and All).

In contrast, the Technology Acceptance Model (TAM) did not predict the total number of queries, suggesting that participants' willingness to use ChatGPT was not strongly determined by whether they perceived it as useful (PU) or easy to use (PEOU). However, All queries were predicted in divergent ways by the two TAM components. TAM perceived usefulness (PU) showed a positive relationship, indicating that participants who viewed ChatGPT as more useful were more likely to rely on it to generate full essays. In contrast, TAM perceived ease of use (PEOU) showed a negative relationship, suggesting that participants who found ChatGPT easy to use were less likely to rely on it for All queries, perhaps because they knew various ways to leverage ChatGPT for writing

<!-- formula-not-decoded -->

tasks beyond delegating the entire essay. Additionally, TAM PU had a negative relationship with Reviewing queries, indicating that participants who perceived ChatGPT as more useful were less inclined to use it for proofreading or revision tasks. Gender and race were also significant predictors: both Male and White participants submitted a higher number of total ChatGPT queries, as well as more Reviewing queries. Age, by contrast, was a negative predictor in two categories: total number of queries and All queries. Older participants used fewer queries on average, particularly in the All category, suggesting that they were less likely to rely on ChatGPT for full text generation.

## 4.3 RQ3: The Relationship Between ChatGPT Usage and Essay Characteristics

For RQ3, we wanted to understand how the specific ways students used ChatGPT in their writing process manifested in their fi nal essays. We analyzed the quantity and quality of the fi nal text, as well as the distribution of human versus AI authorship to assess this relationship. We examined three key characteristics: word count, proportion of the ChatGPT-generated words in the fi nal essay, and readability scores from the Flesch-Kincaid Grade Level and DaleChall metrics. Specifically, how these characteristics varied between the groups: No Query (N) , Planning (P) , Translating (T) , Reviewing (R) , All (A) , and Mixed (M) , as described in Section 4.1.6. The average essay length is shown in Figure 8a. In general, participants who used ChatGPT queries wrote longer essays than those who did not use ChatGPT at all. The difference was statistically significant between Group N and Group A and between Group N and Group R.

> **Figure 8:** Box Plots for Authorship with Post Hoc analysis (* indicates p < 0 . 05 )

![Figure 8](images/figure-8.png)

> **Figure 8:** Box Plots for Authorship with Post Hoc analysis (* indicates p < 0 . 05 )


> **Figure 9:** Box Plots for Readability metrics with Post Hoc analysis (* indicates p < 0 . 05 )

![Figure 9](images/figure-9.png)

> **Figure 9:** Box Plots for Readability metrics with Post Hoc analysis (* indicates p < 0 . 05 )


### 4.3.1 Essay Composition

We tracked both the number of words participants wrote themselves (User Final Word Count) and the number of words pasted from ChatGPT (ChatGPT Final Word Count). In two essays, external words-i.e., words pasted from sources other than ChatGPT or the editor-were added, but they accounted for less than 2% of the respective essays. We then ran a Kruskal-Wallis test on the proportion of ChatGPT-pasted words to examine whether different groups exhibited different behaviors. We had multiple significant groups when looking at the percentage of the fi nal essay that was written by ChatGPT (shown in Figure 8b). Groups N, P, and R resulted in nearly no GPT-pasted words, except
- for a few outliers in Groups P and R. Groups A and M, in contrast, exhibited a wide range of behaviors but a significantly higher proportion of GPT contributing to their fi nal essays. A Kruskal-Wallis test revealed significant differences across groups, with post hoc pairwise comparisons indicating significant differences for (N,A), (N,M), (P,A), (P,M), and (R,A) (all p < . 05).

### 4.3.2 Readability scores

Using the previously discussed clusters, we ran Kruskal-Wallis testing with post-hoc analysis to look for significant differences (Figure 9). For the Flesch-Kincaid Grade Level scores, we found a H ( 5 ) = 32, p < 0 . 001. Post-hoc analysis

![](images/image-2.png)

(a) Perceived Ownership across Group

![Figure 10](images/figure-10.png)

*(b) Creativity Support Index across Group*

> **Figure 10:** Box Plots for PO and CSI metrics with Post Hoc analysis (* indicates p < 0 . 05 )



revealed significant differences between Groups (A,N), (A,P), (A,R), with Group A showing significantly higher Grade Level scores. For Dale-Chall, Kruskal-Wallis testing showed a H ( 5 ) = 34, p < 0 . 001. Post-hoc analysis showed four significant groupings: Group A and Group N, Group A and Group P, Group A and Group R, and Group P with Group M. Both readability metrics showed users in Group A, or users who had ChatGPT write large portions of their essay, produced essays with significantly higher complexity scores than their counterparts; this indicates that ChatGPT generates text with higher complexity. Additionally, the Dale-Chall readability metric reveals a significant difference between Group P and Group M, indicating that the Mixed group had higher complexity scores than the Planning group.

## 4.4 RQ4: Participant Perceptions Towards Their Writing Experiences

For RQ4, we wanted to understand how students' ChatGPT usage during writing would relate to students' perceptions of their writing. We asked users to complete a post-study survey focusing on Perceived Ownership and the Creativity Support Index (CSI) to see how their writing experience varied depending on how they used ChatGPT. We ran Kruskal-Wallis tests on this data to see if there were any relationships between these surveys and the writer groupings. For perceived ownership, the group effects were significant, but we had no significance on the total CSI score (shown in Figure 10). We then looked at the CSI subcategories and found significance in two subscales. Following these results, we conducted post hoc analysis using a Dunn test with Bonferroni correction similar to that in the previous section.

For the Perceived Ownership data, the Kruskal-Wallis test showed H ( 5 ) = 27 . 876, p < 0 . 001. Post-hoc analysis revealed three statistically significant group differences: between Group N and Group A, between Group P and Group A, and between Group R and Group A (Figure 10a). These fi ndings indicate that perceived ownership was significantly lower in the All group compared to the other three groups. This result is unsurprising, as participants in Group A often generated entire essays using ChatGPT and therefore reported lower ownership of the fi nal text. However, the high perceived ownership reported by Groups P and R, comparable to Group N, is noteworthy. From an educational perspective, this may be concerning, as reliance on Planning or Reviewing queries could also influence learning outcomes depending on the objectives of the writing assignment. Ideally, students' sense of authorship should align with their learning outcomes, as their perceived ownership may contribute to their positive experience of using ChatGPT, potentially without learning gain. This highlights the need for instructors to carefully design writing activities and provide guidance on how AI tools should be used.

For the CSI subscales, we found significant effects in Exploration and Immersion. Through Kruskal-Wallis and post hoc analysis for CSI-Exploration (shown in Figure 11a), we found a H ( 5 ) = 11 . 110, p = . 0490 with a significant pair in Groups N and M. This indicates that Group M is able to generate and track their ideas better than the users in Group N. For the CSI-Immersion subscale, we fi nd a H ( 5 ) = 12 . 463 and p = . 0300. Post-hoc analysis showed that Groups P and A were statistically different (shown in Figure 11b). This shows that the users in the Planning group were able to be absorbed into the activity more than the users in the All group.

## 4.5 Dataset

The data used in this study is made publicly available through a data repository. Those interested in the dataset can fi nd it at https://doi.org/10.7910/DVN/K6PSHK.

> **Figure 11:** Box Plots for CSI-Exlploration and CSI-Immersion with Post Hoc analysis (* indicates p < 0 . 05 )

![Figure 11](images/figure-11.png)

> **Figure 11:** Box Plots for CSI-Exlploration and CSI-Immersion with Post Hoc analysis (* indicates p < 0 . 05 )


# 5 Discussion

In summary, our study provides rich insights into how students use ChatGPT for writing assignments and how their usage relates to their backgrounds, essay characteristics, and perceptions. Building on Flower and Hayes' Cognitive Process Theory of Writing, we developed a taxonomy categorizing how participants' queries relate to different processes of the writing process; queries were grouped into Planning, Translating, Reviewing, and All categories. We further identified how factors such as writing self-efficacy, technology acceptance, and demographics influence the frequency of ChatGPT use. A clustering analysis revealed common usage patterns based on the distribution of query types students asked, with perceptions of both their essays and ChatGPT varying accordingly. For example, students who used ChatGPT to generate entire essays reported lower perceived ownership compared to those who engaged with it primarily for Planning and Reviewing.

## 5.1 From Planning to Vibe Writing: Educational Implications of ChatGPT Use

Our fi ndings raise important concerns for writing instructors. When given the opportunity to use ChatGPT, a substantial number of participants engaged in vibe writing, delegating most of the writing process to it. Even when students did not fully outsource their writing, many delegated critical stages such as ideation and opinion formation. This delegation effectively bypasses the processes through which students would otherwise critically engage with the topic, conduct research, translate ideas into a coherent argument, and self-evaluate their work for improvement.

Such behavior aligns with broader concerns that GenAI reduces the perceived effort of critical thinking and fosters overreliance on AI, potentially diminishing independent problem-solving skills among knowledge workers [[67, Lee et al. 2025, Impact of Generative AI](#ref-67)]. Prior studies have also shown that GenAI use can lower cognitive load and even reduce brain activity in ways that may impair cognitive ability [[65, Kosmyna et al. 2025, Your Brain on ChatGPT](#ref-65); [98, Stadler et al. 2024, Cognitive Ease](#ref-98)]. Another thread of research showed that lack of critical engagement can result in compliance with GenAI's suggestions [[13, Bhat et al. 2023, Interacting with Next-Phrase Suggestions](#ref-13); [57, Jakesch et al. 2023, Co-Writing with Opinionated Language Models](#ref-57)]. Our study sheds light on previously hidden student practices and provides a taxonomy to guide future research into the mechanisms by which GenAI use influences learning in the context of writing.

The taxonomy we developed for RQ1 is consistent with the fi ndings of Black and Tomlinson which distinguishe two broad uses of ChatGPT: from lower-order writing tasks (e.g. proofreading, editing) to higher-order tasks (e.g. understanding complex topics, locating evidence)[[15, Black & Tomlinson 2025, University Students Adopt AI](#ref-15)]. Our categories naturally map onto this framework: Planning aligns with higher-order work; Reviewing aligns with lower-order work; and Translating and All correspond to ghostwriting tasks. We extend this prior work by (1) specifying detailed codes within each category of the writing process and (2) contributing empirical interaction data (student queries and model responses) from a specific essay task, allowing deeper analysis and addressing the limitations of self-reported descriptions of ChatGPT use in previous research [[15, Black & Tomlinson 2025, University Students Adopt AI](#ref-15)].

A natural next step is to investigate instructors' perceptions of the types of queries students make to ChatGPT, using our taxonomy as a reference, and to examine how instructors anticipate the potential learning impacts within their courses. Our study helps address limitations in existing research that rely on self-reported surveys from teachers, which are constrained by their limited understanding of how students actually use ChatGPT [[10, Barrett & Pack 2023, Not Quite Eye to A.I.](#ref-10); [16, Bower et al. 2024, ChatGPT Teacher Survey](#ref-16)]. In addition, apart from readability scores, we did not analyze the content or quality of the essay, which could provide further insight into how ChatGPT affects not only student learning, but also assessment practices. For example, students who copied and pasted the prompt produced nearly identical essays, which instructors could readily identify as plagiarism. In contrast, students who engaged in vibe writing-actively shaping the essay at a high level and iteratively guiding GenAI-produced work that appeared original and was far more difficult for instructors to recognize as AI-assisted, as demonstrated in recent work [[113, Zeng et al. 2024, Detecting AI-Generated Sentences](#ref-113)]. This future work can highlight a vulnerability that instructors may face in evaluating student writing in practice.

Another key takeaway from the study results is that the queries that a student asks GenAI alone cannot account for the learning impact that they may have for writing. Some participants used ChatGPT as if it were an expert to ask opinions about, and directly used the text that it generated, while others asked it to generate the entire essay, only to use it as a reference for their own independent writing. This complexity contributes to the challenge of understanding how the usage of LLM would impact a student's learning and regulate their usage per query type when banning is not an option. From our study, at least, the interaction trace that helps instructors have a better understanding will be responses that ChatGPT generates, and how the students consume it, which can manifest through following interaction (e.g., paste events, pause in GPT responses, etc).

## 5.2 Student Personas of ChatGPT Use: Insights for Writing Instruction

The identification of distinct yet recurring patterns in how students use ChatGPT is another contribution of this paper. Through our qualitative analysis of queries, we classified participants into six clusters of writers, suggesting that while individual use varied, their behaviors could be meaningfully grouped. This classification is further supported by the transition matrix and state diagram, which illustrate four critical usage paths (Figure 7b). Building on prior work that emphasized the challenge of classifying users [[21, Chakrabarty et al. 2024, Creativity Support in the Age](#ref-21); [37, Fitzsimons et al. 2025, Pressure to Use AI](#ref-37); [42, Gero et al. 2023, Social Dynamics of AI Support](#ref-42)], we identify six personas and quantify their prevalence within the participant pool, thereby characterizing common patterns of ChatGPT use in writing.

Beyond Group A, the largest cluster, we identified two smaller groups of users who relied on ChatGPT exclusively for distinct purposes: generating ideas (Group P) or refining their fi nal essay (Group R). We also observed a small group of non-users (Group N) who wrote their essays entirely on their own, potentially reflecting resistance to ChatGPT in practice, even when it was explicitly allowed. This is also shown through the total number of ChatGPT words in the fi nal essay. Those in Group P tended to have a small number of ChatGPT words, being significantly different than our All or Mixed groupings. This further suggests Group P as using ChatGPT as an ideation partner or search engine rather than a writer. In contrast, Group M and A exhibited widely different behaviors; the group was divisive, with some participants using ChatGPT-generated words entirely for their essay, while others asked for advice and wrote their essays entirely on their own. While prior work has documented patterns such as ideation and proofreading [[5, Ammari et al. 2025, Students Use ChatGPT](#ref-5); [15, Black & Tomlinson 2025, University Students Adopt AI](#ref-15)], our study extends these fi ndings by showing that students cluster into groups defined by consistent query types-including those who avoid the tool altogether. Previous research has linked hesitation to use ChatGPT to ethical and integrity concerns [[22, Chan & Lee 2023, The AI Generation Gap](#ref-22)]. Investigating why some students limit their use to a single function, or abstain entirely, could provide valuable insight into how they perceive the role of GenAI in the writing process.

One notable pattern we observed was the limited use of Translating, with Group T being smaller than any other group. This contrasts with prior work showing that professional creative writers valued translating assistance from GenAI to overcome writer's block [[42, Gero et al. 2023, Social Dynamics of AI Support](#ref-42)]. A likely explanation lies in motivation: creative writers strive for originality, whereas students in our study had little incentive to produce original essays, especially given the context of a voluntary online study. In contrast, the predominance of the Planning group in our data suggests that a greater hurdle for a larger number of students was deciding what to write, rather than knowing what to write but struggling to begin. This fi nding points to a gap in critical engagement with the assignment topic, suggesting that students may outsource the most cognitively demanding stage of writing to ChatGPT. Such reliance raises concerns for instructors whose goal is to help students critically examine specific topics, such as professionalism or ethics in computing.

We further examined how ChatGPT influenced the fi nal essay through readability scores, fi nding that users who had ChatGPT write text produced higher readability scores. These fi ndings align with other studies where ChatGPT produced text with high complexity scores for technical writing [[76, Marulli et al. 2024, Understanding Readability](#ref-76)], but ChatGPT received lower scores in Flesch-Kincaid Grade Level and Dale-Chall when used for creative writing [[76, Marulli et al. 2024, Understanding Readability](#ref-76); [85, Romoff et al. 2025, Large Language Models](#ref-85)]. We attribute our higher scores to the argumentative nature of the essay prompt.

## 5.3 Student Backgrounds Shape How ChatGPT Is Used in Writing

In RQ2, we investigated the relationship between students' backgrounds and their use of ChatGPT. First, we found that lower writing self-efficacy was linked to more frequent querying overall, particularly for Translating and Reviewing. By contrast, Planning and All did not show the same pattern, suggesting that reliance on ChatGPT for tasks with greater implications for critical engagement may stem less from confidence in writing and more from external factors such as motivation or time pressure.

TAM, which captures students' acceptance of ChatGPT, showed mixed results. Perceived usefulness (TAM PU) was positively associated with All queries, which may suggest that students who trusted the quality of ChatGPT's output were more likely to generate entire essays with it. By contrast, perceived ease of use (TAM PEOU) was negatively associated with All queries; one possible explanation is that students who found ChatGPT easy to use may have had the skills to control it in more targeted ways, reducing the need to generate full essays. Similarly, the negative association between TAM PU and Reviewing queries may indicate a limited understanding of ChatGPT's capabilities, leading students to see it merely as a proofreading tool. This result adds nuances to existing fi ndings where they found that technology acceptance was correlated with the frequency of ChatGPT use [[40, Gan & Ji 2025, Generative AI Tools](#ref-40)].

We also found that gender, age, and race were significant predictors of the Total number of queries submitted. Participants who identified as White or Male submitted significantly more queries, particularly in the Reviewing category. Prior research suggests that women typically report higher self-efficacy in writing and reading [[80, Pajares et al. 2006, Writing Self-Efficacy](#ref-80)], which may help explain why men were more inclined to turn to AI for writing support, as men may have less confidence in their writing skills. This interpretation aligns with our own fi nding of a negative association between Reviewing queries and writing self-efficacy. Other studies have shown that men hold more positive attitudes toward AI -using tools like ChatGPT to validate their work [[45, Grassini & Ree 2023, Hope or Doom AI-ttitude](#ref-45)]-and report greater awareness and perceived knowledge about AI [[19, Cachero et al. 2025, Gender Bias in Self-Perception](#ref-19)]. Interestingly, these perspectives do not align with our result, where TAM PU was negatively associated with Reviewing queries. Age also played a role: a recent study found that younger generations feel pressured to use GenAI in contexts such as university applications [[37, Fitzsimons et al. 2025, Pressure to Use AI](#ref-37); [74, Madden et al. 2024, Dawn of the AI Era](#ref-74)], pointing to distinct adoption patterns. These fi ndings provide a more nuanced understanding of how demographic factors shape GenAI use in writing by informing which type of usage is relevant.

It is worth mentioning that Planning queries did not have any significant predictors. The result may suggest that idea generation is a universal hurdle in writing, one less dependent on confidence, tool perceptions, or demographics, and more influenced by situational factors such as topic familiarity or their intrinsic/extrinsic motivation on a topic or assignment. These interpretations indicate important directions for future research, examining how students' writing background, perceptions of ChatGPT, and demographic characteristics influence both how often they use it and how they engage with it in the writing process.

## 5.4 How ChatGPT Usage Impacts Ownership and Creative Engagement in Writing

We examined how students' writing experiences varied depending on their use of ChatGPT, focusing on Perceived Ownership (PO) and the Creativity Support Index (CSI). We found that PO differed significantly across three pairs of groups: N and A, P and A, and R and A. Unsurprisingly, those who generated an entire essay with ChatGPT felt less ownership than students who engaged with the writing process more directly. Joshi and Vogel reported that providing more detailed, content-rich queries leads to higher perceived ownership [[60, Joshi & Vogel 2025, Writing with AI](#ref-60)]. This helps explain why students who simply copied and pasted the writing prompt into ChatGPT-investing minimal effort-reported lower ownership.

However, a more surprising-and perhaps concerning-finding is that the perceived ownership reported by all other groups who used ChatGPT (P, T, R, M) was comparable to, i.e., not significantly different from, that of Group N, who never used it at all. Despite missed learning opportunities, these students may still have felt that they wrote the essay. This suggests that the selective use of ChatGPT does not reduce students' sense of ownership, even though it may deprive them of the chance to critically engage with the topic, evaluate their work, and revise their writing carefully.

Lastly, students' perceptions of how ChatGPT supported their creative practice revealed subtle differences in two dimensions of the Creativity Support Index: Exploration and Immersion. For Exploration, Group M reported higher support than Group N. Unlike Group A, who primarily relied on ChatGPT to generate text, Group M used it more broadly-for idea generation, revision, and essay construction. They also submitted the largest number of queries overall (Figure 6b), distributed relatively evenly across Planning, Reviewing, and All (Figure 12b). A recent experiment found that intelligent features designed to support ideation made writing more engaging, as measured by increased time spent in the ideation process, though not necessarily in the reviewing process [[43, Göldi et al. 2024, Intelligent Support Engages Writers](#ref-43)]. This aligns with our fi nding that Group M may have engaged in exploring and comparing multiple ideas at a high level, rather than simply delegating their writing or focusing narrowly on expression.

For Immersion, Group P reported higher levels than Group A. Group A had the highest proportion of GPT-pasted words, indicating that their writing experience was shaped largely by text generation. In contrast, Group P concentrated on refining and engaging with the writing process itself, which may have fostered deeper immersion. In some respects, Group P appeared even more focused on writing than Group N, who had to both generate ideas and translate them into words. The ability to concentrate on shaping text may thus enhance immersion, potentially making the writing experience more engaging.

Prior work has already documented how GenAI can scaffold idea generation and support creative expression in various contexts [[20, Chakrabarty et al. 2024, Art or Artifice](#ref-20); [21, Chakrabarty et al. 2024, Creativity Support in the Age](#ref-21); [42, Gero et al. 2023, Social Dynamics of AI Support](#ref-42); [43, Göldi et al. 2024, Intelligent Support Engages Writers](#ref-43); [69, Lee et al. 2022, CoAuthor](#ref-69)]. Our results extend this literature by showing that not all GenAI use is equal: the kinds of queries students make correspond to meaningful differences (or the absence thereof) in specific subcomponents of creative engagement. These results highlight how GenAI can subtly influence creative processes, providing creative professionals and toolmakers with a scaffold for certain types of queries in creative practice to emphasize a particular aspect of their experience (e.g., immersion or exploration).

## 5.5 Enabling Fine-Grained Analysis of AI-Assisted Writing

Our dataset offers value to future research in AI-assisted writing. Researchers in HCI, education, and natural language processing can use this dataset to explore the evolving nature of authorship in AI-assisted contexts. We provide a dataset offering keystroke-level trace data capturing the complete writing process, information not in other datasets [24, 48, 49, 66, 69, 71]. This granularity enables researchers to view how students engaged with ChatGPT over time -whether they gradually incorporated ideas, ignored them, or pasted them into the editor. Additionally, our dataset extends the existing literature by providing work from native English speakers, thereby broadening the scope for comparative research across various educational settings. This process-level data also stimulates research into temporal or causal analysis, work previously difficult or impossible. Researchers can investigate how the timing of AI consultation shapes their writing. The data also reveals critical decision points in a student's writing, such as where students choose to accept, modify, or reject AI suggestions. Furthermore, the data can be used to develop tools for educators, such as real-time dashboards that fl ag students who exhibit over-reliance on AI, or automated systems that provide targeted interventions based on detected usage patterns. By making this dataset publicly available, we anticipate supporting the research community in its efforts to gain a deeper, evidence-based understanding of how generative AI is reshaping writing education.

# 6 Limitations and Future Work

One potential limitation of this work is its ecological validity. Our study was conducted in a low-stakes environment where there were no negative consequences for using ChatGPT in ways that might otherwise be considered cheating. In real classrooms, writing assignments occur under a range of conditions (e.g., timed in-class exercises, untimed homework), whereas our study used only a soft 30-minute constraint. Deploying this kind of system in authentic classroom settings also raises ethical challenges, particularly around assessment, and students' fear of being monitored may discourage authentic use. In addition, we believe that our study captures a common scenario in which students aim to invest just enough effort to produce an essay that they feel is 'good enough' to submit.

It is important to note that our study setting may have implicitly encouraged participants' use of ChatGPT for various reasons: the task was framed as 'a study investigating essay writing and ChatGPT,' the ChatGPT window was visible alongside the editor, and participants may have been motivated to fi nish quickly given the lack of explicit rewards. We acknowledge that such factors could have amplified certain behaviors (e.g., Vibe Writing) observed in the study. However, we also anticipate that this encouragement resembles real situations in which students are tempted to use GenAI-for example, when facing a difficult topic, feeling unmotivated, or having limited time to complete an assignment. Even if some participants used ChatGPT more frequently than they would in authentic classroom settings, the range of behaviors we observed was broad, and most participants still completed the essay without ChatGPT generating major sections. Thus, while institutional or classroom policies may influence the frequency of GenAI use that we found in this paper, we believe that the behavioral patterns we identified (e.g., the taxonomy and the mode of vibe writing) remain meaningful. Similarly, because each student was clustered into one of six archetypes, the size of each group may vary in other contexts, but the relationships we identified-such as differences in essay characteristics or perceptions of ownership and creative engagement-should remain largely consistent. It remains an important area for future work to examine how real-world context and class policies shape students' GenAI behaviors, including cases where students may conceal or misrepresent their usage.

To address this limitation, we plan to deploy a classroom writing environment that integrates an in-house version of ChatGPT, where use is guided and regulated by instructor-defined GenAI policies. In this accountable AI platform, (1) students' queries are made transparent to instructors, (2) instructors provide explicit guidance on acceptable use, and (3) the in-house ChatGPT adapts its responses according to the instructor's specifications. Building on the taxonomy developed in this study, the system will classify student queries and either scaffold learning or decline to answer, depending on the policy. To ensure practical enforceability, the platform can restrict external GenAI use-for example, by disabling copy-paste from outside sources or embedding the model within a lockdown browser. Such design choices make the system realistic for classroom deployment while also enabling instructors to experiment with different policies and generate empirical evidence on how instructional contexts shape both student learning and ethical engagement with AI.

One missed opportunity in this work, which motivates our immediate future work, is understanding how their ChatGPT usage pattern impacts the quality of the essay; we did not have human evaluations of essay quality and originality. Human evaluators (e.g., instructors) can provide greater insights regarding argument coherence, creativity, and critical thinking, dimensions not captured through readability scores, and relate them to how they used ChatGPT.In our future study, we will provide the fi nal essay to instructors without ChatGPT histories to grade the essay. Then we can open students' AI history and study how instructors change their opinions, using this information to understand the learning impacts they can anticipate per query type or per student archetype. This will provide further insight into the impact of AI on student writing and inform policy regarding the use of AI in writing instruction.

# Acknowledgments

We thank the reviewers for their constructive and insightful feedback, which helped improve this work, and we are grateful to all participants for their time and contributions. This research was supported in part by funding from the Center for Human Computer Interaction (CHCI) Planning Grant at Virginia Tech, and the 4VA grant. The views expressed in this material are those of the authors and do not necessarily reflect the views of the funding agencies.

# References

<a id="ref-1"></a>**[1]** Catherine Adams, Patti Pente, Gillian Lemermeyer, Joni Turville, Geoffrey Rockwell. [Artificial Intelligence and Teachers' New Ethical Obligations](https://doi.org/10.29173/ irie483). The International Review of Information Ethics 2022 *(Teachers' New Ethical Obligations)*

<a id="ref-2"></a>**[2]** Tazin Afrin, Omid Kashefi, Christopher Olshefski, Diane Litman, Rebecca Hwa, Amanda Godley. [Effective Interfaces for Student-Driven Revision Sessions for Argumentative Writing](https://doi.org/10. 1145/3411764.3445683). Proceedings of the 2021 CHI Conference on Human Factors in Computing Systems 2021 *(Student-Driven Revision Sessions)*

<a id="ref-3"></a>**[3]** M. AlAfnan, Samira Dishari, Marina Jovic, Koba Lomidze. [ChatGPT as an Educational Tool: Opportunities, Challenges, and Recommendations for Communication, Business Writing, and Composition Courses](https://doi.org/10.37965/jait.2023.0184). Journal of Artificial Intelligence and Technology 2023 *(ChatGPT)*

<a id="ref-4"></a>**[4]** Jamal Kaid Mohammed Ali, Muayad Abdulhalim Ahmad Shamsan, Taha Ahmed Hezam, Ahmed A. Q. Mohammed. [Impact of ChatGPT on Learning Motivation: Teachers and Students' Voices](https://doi.org/10.56540/jesaf.v2i1.51). Journal of English Studies in Arabia Felix 2023 *(ChatGPT Learning Motivation)*

<a id="ref-5"></a>**[5]** Tawfiq Ammari, Meilun Chen, SM Zaman, Kiran Garimella. [How Students (Really) Use ChatGPT: Uncovering Experiences Among Undergraduate Students](https://arxiv.org/abs/2505.24126). arXiv preprint arXiv:2505.24126 2025 *(Students Use ChatGPT)*

<a id="ref-6"></a>**[6]** Arthur N. Applebee. [Writing and Reasoning](https://doi.org/10.3102/00346543054004577). Review of Educational Research 1984 *(Writing and Reasoning)*

<a id="ref-7"></a>**[7]** James B. Avey, Bruce J. Avolio, Craig D. Crossley, Fred Luthans. [Psychological ownership: theoretical extensions, measurement and relation to work outcomes](https://doi.org/10. 1002/job.583). Journal of Organizational Behavior 2009 *(Psychological Ownership)*

<a id="ref-8"></a>**[8]** Musa Adekunle Ayanwale, Ismaila Temitayo Sanusi, Owolabi Paul Adelana, Kehinde D. Aruleba, Solomon Sunday Oyelere. [Teachers' readiness and intention to teach artificial intelligence in schools](https://doi.org/10.1016/j.caeai.2022.100099). Computers and Education: Artificial Intelligence 2022 *(Teachers' Readiness)*

<a id="ref-9"></a>**[9]** David Baidoo-Anu, Leticia Owusu Ansah. [Education in the Era of Generative Artificial Intelligence (AI): Understanding the Potential Benefits of ChatGPT in Promoting Teaching and Learning](https://doi.org/10.2139/ssrn.4337484). 2023 *(Generative Artificial Intelligence)*

<a id="ref-10"></a>**[10]** Alex Barrett, Austin Pack. [Not quite eye to A.I.: student and teacher perspectives on the use of generative artificial intelligence in the writing process](https://doi.org/10.1186/s41239-023-00427-0). International Journal of Educational Technology in Higher Education 2023 *(Not Quite Eye to A.I.)*

<a id="ref-11"></a>**[11]** Carl Bereiter, Marlene Scardamalia. The psychology of written composition. Routledge 2013 *(Psychology of Written Composition)*

<a id="ref-12"></a>**[12]** Arne Bewersdorff, Marie Hornberger, Claudia Nerdel, Daniel S. Schiff. [AI advocates and cautious critics: How AI attitudes, AI interest, use of AI, and AI literacy build university students' AI self-efficacy](https://doi.org/10.1016/j.caeai.2024.100340). Computers and Education: Artificial Intelligence 2025 *(AI Advocates and Cautious Critics)*

<a id="ref-13"></a>**[13]** Advait Bhat, Saaket Agashe, Niharika Mohile, Parth Oberoi, Ravi Jangir, Anirudha Joshi. [Interacting with next-phrase suggestions: How suggestion systems aid and influence the cognitive processes of writing](https://doi.org/10.1145/3581641.3584060). Proceedings of the 28th International Conference on Intelligent User Interfaces 2023 *(Interacting with Next-Phrase Suggestions)*

<a id="ref-14"></a>**[14]** Som Biswas. Role of Chat GPT in Education. 2023 *(Role of Chat GPT)*

<a id="ref-15"></a>**[15]** Rebecca W Black, Bill Tomlinson. University students describe how they adopt AI for writing and research in a general education course. Scientific reports 2025 *(University Students Adopt AI)*

<a id="ref-16"></a>**[16]** Matt Bower, Jodie Torrington, Jennifer W. M. Lai, Peter Petocz, Mark Alfano. [How should we change teaching and assessment in response to increasingly powerful generative Artificial Intelligence? Outcomes of the ChatGPT teacher survey](https://doi.org/10.1007/s10639-023-12405-0). Education and Information Technologies 2024 *(ChatGPT Teacher Survey)*

<a id="ref-17"></a>**[17]** Roger Bruning, Michael Dempsey, Douglas F Kauffman, Courtney McKim, Sharon Zumbrunn. Examining dimensions of self-efficacy for writing. Journal of educational psychology 2013 *(Dimensions of Self-Efficacy)*

<a id="ref-18"></a>**[18]** Zana Buçinca, Maja Barbara Malaya, Krzysztof Z. Gajos. [To Trust or to Think: Cognitive Forcing Functions Can Reduce Overreliance on AI in AI-assisted Decision-making](https://doi.org/10.1145/3449287). Proceedings of the ACM on Human-Computer Interaction 2021 *(To Trust or to Think)*

<a id="ref-19"></a>**[19]** Cristina Cachero, David Tomás, Francisco A. Pujol. [Gender Bias in Self-Perception of AI Knowledge, Impact, and Support among Higher Education Students: An Observational Study](https://doi.org/10.1145/3721295). ACM Trans. Comput. Educ. 2025 *(Gender Bias in Self-Perception)*

<a id="ref-20"></a>**[20]** Tuhin Chakrabarty, Philippe Laban, Divyansh Agarwal, Smaranda Muresan, Chien-Sheng Wu. [Art or Artifice? Large Language Models and the False Promise of Creativity](https://doi.org/10.1145/3613904.3642731). Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems 2024 *(Art or Artifice)*

<a id="ref-21"></a>**[21]** Tuhin Chakrabarty, Vishakh Padmakumar, Faeze Brahman, Smaranda Muresan. [Creativity Support in the Age of Large Language Models: An Empirical Study Involving Professional Writers](https://doi.org/10.1145/3635636.3656201). Proceedings of the 16th Conference on Creativity & Cognition 2024 *(Creativity Support in the Age)*

<a id="ref-22"></a>**[22]** Cecilia Ka Yuk Chan, Katherine K. W. Lee. [The AI generation gap: Are Gen Z students more interested in adopting generative AI such as ChatGPT in teaching and learning than their Gen X and Millennial Generation teachers?](https://doi.org/10.48550/arXiv.2305.02878). 2023 *(The AI Generation Gap)*

<a id="ref-23"></a>**[23]** Olckers Chantal. [Psychological ownership: Development of an instrument](https://doi.org/10.4102/sajip.v39i2.1105). SA Journal of Industrial Psychology 2012 *(Psychological Ownership)*

<a id="ref-24"></a>**[24]** Aaron Chatterji, Thomas Cunningham, David J. Deming, Zoe Hitzig, Christopher Ong, Carl Yan Shan, Kevin Wadman. [How People Use ChatGPT](https://doi.org/10.3386/w34255). 2025 *(How People Use ChatGPT)*

<a id="ref-25"></a>**[25]** Fumian Chen, Sotheara Veng, Joshua Wilson, Xiaoming Li, Hui Fang. [CoachGPT: A Scaffolding-based Academic Writing Assistant](https://doi.org/10.1145/3726302.3730143). Proceedings of the 48th International ACM SIGIR Conference on Research and Development in Information Retrieval (SIGIR '25) 2025 *(CoachGPT)*

<a id="ref-26"></a>**[26]** Erin Cherry, Celine Latulipe. [Quantifying the Creativity Support of Digital Tools through the Creativity Support Index](https://doi.org/10.1145/2617588). ACM Trans. Comput.-Hum. Interact. 2014 *(Creativity Support Index)*

<a id="ref-27"></a>**[27]** William Condon, Diane Kelly-Riley. Assessing and teaching what we value: The relationship between college-level writing and critical thinking abilities. Assessing Writing 2004 *(Assessing and Teaching What We Value)*

<a id="ref-28"></a>**[28]** Debby R. E. Cotton, Peter A. Cotton, J. Reuben Shipway. [Chatting and cheating: Ensuring academic integrity in the era of ChatGPT](https://doi.org/10.1080/14703297.2023.2190148). Innovations in Education and Teaching International 2023 *(Chatting and Cheating)*

<a id="ref-29"></a>**[29]** Helen Crompton, Diane Burke. [Artificial intelligence in higher education: the state of the fi eld](https://doi.org/10.1186/s41239-023-00392-8). International Journal of Educational Technology in Higher Education 2023 *(Artificial Intelligence in Higher Education)*

<a id="ref-30"></a>**[30]** Edgar Dale, Jeanne S. Chall. A Formula for Predicting Readability. Educational Research Bulletin 1948 *(Predicting Readability)*

<a id="ref-31"></a>**[31]** Fred D. Davis. [Perceived Usefulness, Perceived Ease of Use, and User Acceptance of Information Technology](https://doi.org/10.2307/249008). MIS Quarterly 1989 *(Perceived Usefulness)*

<a id="ref-32"></a>**[32]** Peter A. Cotton, Debby R. E. Cotton, J. Reuben Shipway. [Chatting and cheating: Ensuring academic integrity in the era of ChatGPT](https://doi.org/10.1080/14703297.2023.2190148). Innovations in Education and Teaching International 2024 *(Chatting and Cheating)*

<a id="ref-33"></a>**[33]** Yanning Dong, Ling Shi. [Using Grammarly to support students' sourcebased writing practices](https://doi.org/10.1016/j.asw.2021.100564). Assessing Writing 2021 *(Grammarly)*

<a id="ref-34"></a>**[34]** Damian Okaibedi Eke. [ChatGPT and the rise of generative AI: Threat to academic integrity?](https://doi.org/10.1016/j.jrt.2023.100060). Journal of Responsible Technology 2023 *(ChatGPT and the Rise)*

<a id="ref-35"></a>**[35]** J. Emig. [Writing as a Mode of Learning](https://doi.org/10.2307/356095). College Composition and Communication 1977 *(Writing as a Mode of Learning)*

<a id="ref-36"></a>**[36]** Juan Escalante, Austin Pack, Alex Barrett. AI-generated feedback on writing: Insights into efficacy and ENL student preference. International Journal of Educational Technology in Higher Education 2023 *(AI-generated Feedback on Writing)*

<a id="ref-37"></a>**[37]** Aidan Z Fitzsimons, Elizabeth Gerber, Duri Long. [Pressure to use AI for college admissions: implications for adolescent self-concept and intelligent coaching design](https://doi.org/10.1145/3698061.3726909). Proceedings of the 2025 Conference on Creativity and Cognition 2025 *(Pressure to Use AI)*

<a id="ref-38"></a>**[38]** Rudolph Flesch. [A new readability yardstick](https://doi.org/10.1037/h0057532). Journal of Applied Psychology 1948 *(Readability Yardstick)*

<a id="ref-39"></a>**[39]** Linda Flower, John R. Hayes. [A Cognitive Process Theory of Writing](https://doi.org/10.2307/356600). College Composition and Communication 1981 *(Cognitive Process Theory)*

<a id="ref-40"></a>**[40]** Hanying Gan, Wei Ji. [Research on Evaluating College Students' Usage Behaviors and Patterns of Generative AI Tools Using Natural Language Processing](https://doi.org/10.1145/3745238.3745434). Proceedings of the 2nd Guangdong-Hong Kong-Macao Greater Bay Area International Conference on Digital Economy and Artificial Intelligence 2025 *(Generative AI Tools)*

<a id="ref-41"></a>**[41]** Katy Ilonka Gero, Vivian Liu, Lydia Chilton. [Sparks: Inspiration for Science Writing using Language Models](https://doi.org/10.1145/3532106.3533533). Proceedings of the 2022 ACM Designing Interactive Systems Conference 2022 *(Sparks)*

<a id="ref-42"></a>**[42]** Katy Ilonka Gero, Tao Long, Lydia B Chilton. [Social Dynamics of AI Support in Creative Writing](https://doi.org/10.1145/3544548.3580782). Proceedings of the 2023 CHI Conference on Human Factors in Computing Systems 2023 *(Social Dynamics of AI Support)*

<a id="ref-43"></a>**[43]** Andreas Göldi, Thiemo Wambsganss, Seyed Parsa Neshaei, Roman Rietsche. [Intelligent Support Engages Writers Through Relevant Cognitive Processes](https://doi.org/10.1145/3613904.3642549). Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems 2024 *(Intelligent Support Engages Writers)*

<a id="ref-44"></a>**[44]** grammarly. grammarly. 2023 *(Grammarly)*

<a id="ref-45"></a>**[45]** Simone Grassini, Alexander Sævild Ree. [Hope or Doom AI-ttitude? Examining the Impact of Gender, Age, and Cultural Differences on the Envisioned Future Impact of Artificial Intelligence on Humankind](https://doi.org/10.1145/3605655.3605669). Proceedings of the European Conference on Cognitive Ergonomics 2023 2023 *(Hope or Doom AI-ttitude)*

<a id="ref-46"></a>**[46]** Alicia Guo, Shreya Sathyanarayanan, Leijie Wang, Jeffrey Heer, Amy Zhang. [From Pen to Prompt: How Creative Writers Integrate AI into their Writing Practice](https://doi.org/10.48550/arXiv.2411.03137). 2025 *(From Pen to Prompt)*

<a id="ref-47"></a>**[47]** Mohanad Halaweh. ChatGPT in education: Strategies for responsible implementation. TBD 2023 *(ChatGPT)*

<a id="ref-48"></a>**[48]** Jieun Han, Haneul Yoo, Yoonsu Kim, Junho Myung, Minsun Kim, Hyunseung Lim, Juho Kim, Tak Yeon Lee, Hwajung Hong, So-Yeon Ahn, Alice Oh. [RECIPE: How to Integrate ChatGPT into EFL Writing Education](https://doi.org/10.1145/3573051.3596200). Proceedings of the Tenth ACM Conference on Learning @ Scale 2023 *(RECIPE)*

<a id="ref-49"></a>**[49]** Jieun Han, Haneul Yoo, Junho Myung, Minsun Kim, Tak Yeon Lee, So-Yeon Ahn, Alice Oh. RECIPE4U: Student-ChatGPT Interaction Dataset in EFL Writing Education *(RECIPE4U)*

<a id="ref-50"></a>**[50]** Emma Harvey, Allison Koenecke, Rene F. Kizilcec. ["Don't Forget the Teachers": Towards an Educator-Centered Understanding of Harms from Large Language Models in Education](https://doi.org/10.48550/arXiv.2502.14592). 2025 *(Don't Forget the Teachers)*

<a id="ref-51"></a>**[51]** Daniel Herman. The End of High-School English. The Atlantic 2022 *(The End of High-School English)*

<a id="ref-52"></a>**[52]** Wayne Holmes, Fengchun Miao, et al.. Guidance for generative AI in education and research. UNESCO Publishing 2023 *(Guidance for Generative AI)*

<a id="ref-53"></a>**[53]** Hui-Wen Huang, Zehui Li, Linda Taylor. [The Effectiveness of Using Grammarly to Improve Students' Writing Skills](https://doi.org/10.1145/3402569.3402594). Proceedings of the 5th International Conference on Distance Education and Learning (ICDEL '20) 2020 *(Effectiveness of Using Grammarly)*

<a id="ref-54"></a>**[54]** Gwo-Jen Hwang, Ching-Yi Chang. [A review of opportunities and challenges of chatbots in education](https://doi.org/10.1080/10494820.2021.1952615). Interactive Learning Environments 2021 *(Opportunities and Challenges of Chatbots)*

<a id="ref-55"></a>**[55]** Takumi Ito, Tatsuki Kuribayashi, Masatoshi Hidaka, Jun Suzuki, Kentaro Inui. [Langsmith: An Interactive Academic Text Revision System](https://doi.org/10.18653/v1/2020.emnlpdemos.28). Proceedings of the 2020 Conference on Empirical Methods in Natural Language Processing: System Demonstrations 2020 *(Langsmith)*

<a id="ref-56"></a>**[56]** Zorana Ivcevic, Mike Grandinetti. [Artificial intelligence as a tool for creativity](https://doi.org/10.1016/j.yjoc.2024.100079). Journal of Creativity 2024 *(Artificial Intelligence as a Tool)*

<a id="ref-57"></a>**[57]** Maurice Jakesch, Advait Bhat, Daniel Buschek, Lior Zalmanson, Mor Naaman. [Co-Writing with Opinionated Language Models Affects Users' Views](https://doi.org/10.1145/3544548.3581196). Proceedings of the 2023 CHI Conference on Human Factors in Computing Systems 2023 *(Co-Writing with Opinionated Language Models)*

<a id="ref-58"></a>**[58]** Jaeho Jeon, Seongyong Lee. [Large language models in education: A focus on the complementary relationship between human teachers and ChatGPT](https://doi.org/10.1007/s10639-02311834-1). Education and Information Technologies 2023 *(Large Language Models in Education)*

<a id="ref-59"></a>**[59]** Jisuake. CodeMirror Record. 2023 *(CodeMirror Record)*

<a id="ref-60"></a>**[60]** Nikhita Joshi, Daniel Vogel. [Writing with AI Lowers Psychological Ownership, but Longer Prompts Can Help](https://doi.org/10.1145/3719160.3736608). Proceedings of the 7th ACM Conference on Conversational User Interfaces (CUI '25) 2025 *(Writing with AI)*

<a id="ref-61"></a>**[61]** Enkelejda Kasneci, Kathrin Sessler, Frank Fischer, Urs Gasser, Georg Groh. ChatGPT for Good? On Opportunities and Challenges of Large Language Models for Education *(ChatGPT for Good)*

<a id="ref-62"></a>**[62]** George R. Klare. [The measurement of readability: useful information for communicators](https://doi.org/10.1145/344599.344630). ACM J. Comput. Doc. 2000 *(Measurement of Readability)*

<a id="ref-63"></a>**[63]** Simon Knight, Antonette Shibani, Sophie Abel, Andrew Gibson, Philippa Ryan, Nicole Sutton, Raechel Wight, Cherie Lucas, Ágnes Sándor, Kirsty Kitto, Ming Liu, Radhika Vijay Mogarkar, and Simon Buckingham Shum. [AcaWriter: A learning analytics tool for formative feedback on academic writing](https://doi.org/10.17239/jowr-2020.12.01.06). Journal of Writing Research 2020 *(AcaWriter)*

<a id="ref-64"></a>**[64]** Svetlana Koltovskaia. [Student engagement with automated written corrective feedback (AWCF) provided by Grammarly : A multiple case study](https://doi.org/10.1016/j.asw.2020.100450). Assessing Writing 2020 *(Automated Written Corrective Feedback)*

<a id="ref-65"></a>**[65]** Nataliya Kosmyna, Eugene Hauptmann, Ye Tong Yuan, Jessica Situ, Xian-Hao Liao, Ashly Vivian Beresnitzky, Iris Braunstein, and Pattie Maes. [Your Brain on ChatGPT: Accumulation of Cognitive Debt when Using an AI Assistant for Essay Writing Task](https://arxiv.org/abs/2506.08872). 2025 *(Your Brain on ChatGPT)*

<a id="ref-67"></a>**[67]** Hao-Ping (Hank) Lee, Advait Sarkar, Lev Tankelevitch, Ian Drosos, Sean Rintel, Richard Banks, and Nicholas Wilson. [The Impact of Generative AI on Critical Thinking: Self-Reported Reductions in Cognitive Effort and Confidence Effects From a Survey of Knowledge Workers](https://doi.org/10.1145/3706598.3713778). Proceedings of the 2025 CHI Conference on Human Factors in Computing Systems (CHI '25) 2025 *(Impact of Generative AI)*

<a id="ref-68"></a>**[68]** Mina Lee, Katy Ilonka Gero, John Joon Young Chung, Simon Buckingham Shum, Vipul Raheja, Hua Shen, Subhashini Venugopalan, Thiemo Wambsganss, David Zhou, Emad A. Alghamdi, Tal August, Avinash Bhat, Madiha Zahrah Choksi, Senjuti Dutta, Jin L.C. Guo, Md Naimul Hoque, Yewon Kim, Simon Knight, Seyed Parsa Neshaei, Antonette Shibani, Disha Shrivastava, Lila Shroff, Agnia Sergeyuk, Jessi Stark, Sarah Sterman, Sitong Wang, Antoine Bosselut, Daniel Buschek, Joseph Chee Chang, Sherol Chen, Max Kreminski, Joonsuk Park, Roy Pea, Eugenia Ha Rim Rho, Zejiang Shen, and Pao Siangliulue. [A Design Space for Intelligent and Interactive Writing Assistants](https://doi.org/10.1145/3613904.3642697). Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems (CHI '24) 2024 *(Design Space for Writing Assistants)*

<a id="ref-69"></a>**[69]** Mina Lee, Percy Liang, and Qian Yang. [CoAuthor: Designing a Human-AI Collaborative Writing Dataset for Exploring Language Model Capabilities](https://doi.org/10.1145/3491102.3502030). Proceedings of the 2022 CHI Conference on Human Factors in Computing Systems (CHI '22) 2022 *(CoAuthor)*

<a id="ref-70"></a>**[70]** Rongxin Liu, Carter Zenke, Charlie Liu, Andrew Holmes, Patrick Thornton, and David J. Malan. [Teaching CS50 with AI: Leveraging Generative Artificial Intelligence in Computer Science Education](https://doi.org/10.1145/3626252.3630938). Proceedings of the 55th ACM Technical Symposium on Computer Science Education V. 1 (SIGCSE 2024) 2024 *(Teaching CS50 with AI)*

<a id="ref-71"></a>**[71]** Zeyan Liu, Zijun Yao, Fengjun Li, and Bo Luo. [On the Detectability of ChatGPT Content: Benchmarking, Methodology, and Evaluation through the Lens of Academic Writing](https://doi.org/10.1145/3658644.3670392). Proceedings of the 2024 on ACM SIGSAC Conference on Computer and Communications Security (CCS '24) 2024 *(Detectability of ChatGPT Content)*

<a id="ref-72"></a>**[72]** Victoria Livingstone. I Quit Teaching Because of ChatGPT. TIME 2024 *(I Quit Teaching Because of ChatGPT)*

<a id="ref-73"></a>**[73]** Shuai Ma, Ying Lei, Xinru Wang, Chengbo Zheng, Chuhan Shi, Ming Yin, Xiaojuan Ma. [Who Should I Trust: AI or Myself? Leveraging Human and AI Correctness Likelihood to Promote Appropriate Trust in AI-Assisted Decision-Making](https://doi.org/10.48550/arXiv.2301.05809). 2023 *(Who Should I Trust)*

<a id="ref-74"></a>**[74]** Mary Madden, Amanda Calvin, Abigail Hasse, Amanda Lenhart. The Dawn of the AI Era: Teens, Parents, and the Adoption of Generative AI at Home and School. Common Sense, San Francisco, CA 2024 *(Dawn of the AI Era)*

<a id="ref-75"></a>**[75]** Stephen Marche. The College Essay Is Dead. The Atlantic 2022 *(College Essay)*

<a id="ref-76"></a>**[76]** Fiammetta Marulli, Lelio Campanile, Maria Stella de Biase, Stefano Marrone, Laura Verde, Marianna Bifulco. [Understanding Readability of Large Language Models Output: An Empirical Analysis](https://doi.org/10.1016/j.procs.2024.09.636). Procedia Computer Science 2024 *(Understanding Readability)*

<a id="ref-77"></a>**[77]** Patricia McCarthy, Scott Meier, Regina Rinderer. Self-Efficacy and Writing: A Different View of Self-Evaluation. CollegeCompositionand Communication *(Self-Efficacy and Writing)*

<a id="ref-78"></a>**[78]** Mary L McHugh. Interrater reliability: the kappa statistic. Biochemia medica 2012 *(Interrater Reliability)*

<a id="ref-79"></a>**[79]** Michael Sheinman Orenstrakh, Oscar Karnalim, Carlos Aníbal Suárez, Michael Liut. [Detecting LLM-Generated Text in Computing Education: Comparative Study for ChatGPT Cases](https://doi.org/10.1109/COMPSAC61105.2024.00027). 2024 IEEE 48th Annual Computers, Software, and Applications Conference (COMPSAC) 2024 *(Detecting LLM-Generated Text)*

<a id="ref-80"></a>**[80]** Frank Pajares, Gio Valiante, Yuk Fai Cheong. [Writing Self-Efficacy and Its Relation to Gender, Writing Motivation and Writing Competence: A Developmental Perspective](https://doi.org/10.1163/9781849508216\_009). Writing and Motivation 2006 *(Writing Self-Efficacy)*

<a id="ref-81"></a>**[81]** Hyanghee Park, Daehwan Ahn. [The Promise and Peril of ChatGPT in Higher Education: Opportunities, Challenges, and Design Implications](https://doi.org/10.1145/3613904.3642785). Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems (CHI '24) 2024 *(Promise and Peril of ChatGPT)*

<a id="ref-82"></a>**[82]** Mike Perkins. [Academic integrity considerations of AI Large Language Models in the post-pandemic era: ChatGPT and beyond](https://doi.org/10.53761/1.20.02.07). Journal of University Teaching and Learning Practice 2023 *(Academic Integrity Considerations)*

<a id="ref-83"></a>**[83]** Ali Quidwai, Chunhui Li, Parijat Dube. [Beyond Black Box AI generated Plagiarism Detection: From Sentence to Document Level](https://doi.org/10.18653/v1/2023.bea-1.58). Proceedings of the 18th Workshop on Innovative Use of NLP for Building Educational Applications (BEA 2023) 2023 *(Beyond Black Box AI)*

<a id="ref-84"></a>**[84]** Mohi Reza, Jeb Thomas-Mitchell, Peter Dushniku, Nathan Laundry, Joseph Jay Williams, Anastasia Kuzminykh. [Co-Writing with AI, on Human Terms: Aligning Research with User Demands Across the Writing Process](https://doi.org/10.1145/3757566). Proceedings of the ACM on Human-Computer Interaction 2025 *(Co-Writing with AI)*

<a id="ref-85"></a>**[85]** Melissa Romoff, Madison Brunette, Melanie K. Peterson, Sohaib Z. Hashmi, Michael S. Kim. [The role of large language models in improving the readability of orthopaedic spine patient educational material](https://doi.org/10.1186/s13018-02505955-1). Journal of Orthopaedic Surgery and Research 2025 *(Large Language Models)*

<a id="ref-86"></a>**[86]** Naveed Saif, Sajid Ullah Khan, Imrab Shaheen, Faiz Abdullah ALotaibi, Mrim M. Alnfiai, Mohammad Arif. [Chat-GPT; validating Technology Acceptance Model (TAM) in education sector via ubiquitous learning mechanism](https://doi.org/10.1016/j.chb.2023.108097). Computers in Human Behavior 2024 *(Technology Acceptance Model)*

<a id="ref-87"></a>**[87]** Malik Sallam. [ChatGPT Utility in Healthcare Education, Research, and Practice: Systematic Review on the Promising Perspectives and Valid Concerns](https://doi.org/10.3390/healthcare11060887). Healthcare 2023 *(ChatGPT Utility in Healthcare)*

<a id="ref-88"></a>**[88]** Advait Sarkar, Ian Drosos. [Vibe coding: programming through conversation with artificial intelligence](https://arxiv.org/abs/2506.23253). arXiv preprint 2025 *(Vibe Coding)*

<a id="ref-89"></a>**[89]** Ghadeer Sawalha, Imran Taj, Abdulhadi Shoufan. [Analyzing student prompts and their effect on ChatGPT's performance](https://doi.org/10.1080/2331186X.2024.2397200). Cogent Education 2024 *(Student Prompts)*

<a id="ref-90"></a>**[90]** Peter Scarfe, Kelly Watcham, Alasdair Clarke, Etienne Roesch. A real-world test of artificial intelligence infiltration of a university examinations system: A 'Turing Test' case study. PloS one 2024 *(Artificial Intelligence Infiltration)*

<a id="ref-91"></a>**[91]** Johannes Schneider, Abraham Bernstein, Jan vom Brocke, Kostadin Damevski, David C. Shepherd. [Detecting Plagiarism Based on the Creation Process](https://doi.org/10.1109/TLT.2017.2720171). IEEE Transactions on Learning Technologies 2018 *(Detecting Plagiarism)*

<a id="ref-92"></a>**[92]** Antonette Shibani, Simon Buckingham Shum. [AI-Assisted Writing in Education: Ecosystem Risks and Mitigations](https://doi.org/10.1145/3690712.3690714). Proceedings of the Third Workshop on Intelligent and Interactive Writing Assistants 2024 *(AI-Assisted Writing)*

<a id="ref-93"></a>**[93]** Antonette Shibani, Simon Knight, Simon Buckingham Shum. Contextualizable learning analytics design: A generic model and writing analytics evaluations. Proceedings of the 9th international conference on learning analytics & knowledge 2019 *(Learning Analytics Design)*

<a id="ref-94"></a>**[94]** Abdulhadi Shoufan. [Exploring Students' Perceptions of ChatGPT: Thematic Analysis and Follow-Up Survey](https://doi.org/10.1109/ACCESS.2023.3268224). IEEE Access 2023 *(Students' Perceptions of ChatGPT)*

<a id="ref-95"></a>**[95]** Marita Skjuve, Petter Bae Brandtzaeg, Asbjørn Følstad. [Why do people use ChatGPT? Exploring user motivations for generative conversational AI](https://doi.org/10.5210/fm.v29i1.13541). First Monday 2024 *(User Motivations for ChatGPT)*

<a id="ref-96"></a>**[96]** Sarin Sok, Kimkong Heng. [ChatGPT for Education and Research: A Review of Benefits and Risks](https://doi.org/10.2139/ssrn.4378735). 2023 *(ChatGPT for Education)*

<a id="ref-97"></a>**[97]** Cuiping Song, Yanping Song. [Enhancing academic writing skills and motivation: assessing the efficacy of ChatGPT in AI-assisted language learning for EFL students](https://doi.org/10.3389/fpsyg.2023.1260843). Frontiers in Psychology 2023 *(Enhancing Academic Writing Skills)*

<a id="ref-98"></a>**[98]** Matthias Stadler, Maria Bannert, Michael Sailer. [Cognitive ease at a cost: LLMs reduce mental effort but compromise depth in student scientific inquiry](https://doi.org/10.1016/j.chb.2024.108386). Computers in Human Behavior 2024 *(Cognitive Ease)*

<a id="ref-99"></a>**[99]** Mei Tan, Hansol Lee, Dakuo Wang, Hari Subramonyam. [Is a Seat at the Table Enough? Engaging Teachers and Students in Dataset Specification for ML in Education](https://doi.org/10.1145/3637358). Proc. ACM Hum.-Comput. Interact. 2024 *(Seat at the Table)*

<a id="ref-100"></a>**[100]** Robert L. Thorndike. [Who Belongs in the Family?](https://doi.org/10.1007/BF02289263). Psychometrika 1953 *(Who Belongs in the Family)*

<a id="ref-101"></a>**[101]** Don Vandewalle, Linn Van Dyne, Tatiana Kostova. [Psychological Ownership: An Empirical Examination of its Consequences](https://doi.org/10.1177/1059601195202008). Group & Organization Management 1995 *(Psychological Ownership)*

<a id="ref-102"></a>**[102]** Carole Wade. Using writing to develop and assess critical thinking. Teaching of psychology 1995 *(Critical Thinking)*

<a id="ref-103"></a>**[103]** Qian Wan, Siying Hu, Yu Zhang, Piaohong Wang, Bo Wen, Zhicong Lu. ["It Felt Like Having a Second Mind": Investigating Human-AI Co-creativity in Prewriting with Large Language Models](https://doi.org/10.1145/3637361). Proc. ACM Hum.-Comput. Interact. 2024 *(Human-AI Co-creativity)*

<a id="ref-104"></a>**[104]** Jin Wang, Wenxiang Fan. [The effect of ChatGPT on students' learning performance, learning perception, and higher-order thinking: insights from a meta-analysis](https://doi.org/10.1057/s41599-025-04787-y). Humanities and Social Sciences Communications 2025 *(ChatGPT)*

<a id="ref-105"></a>**[105]** Tianjia Wang, Daniel Vargas Díaz, Chris Brown, Yan Chen. [Exploring the Role of AI Assistants in Computer Science Education: Methods, Implications, and Instructor Perspectives](https://doi.org/10.1109/VL-HCC57772.2023.00018). 2023 IEEE Symposium on Visual Languages and Human-Centric Computing (VL/HCC) 2023 *(Role of AI Assistants)*

<a id="ref-106"></a>**[106]** Sanket Warrier. Ph.D. student sues UMN, fi les human rights complaint after AI plagiarism expulsion. 2024 *(Ph.D. Student Sues UMN)*

<a id="ref-107"></a>**[107]** Azmine Toushik Wasi, Mst Rafia Islam, Raima Islam. [LLMs as Writing Assistants: Exploring Perspectives on Sense of Ownership and Reasoning](https://doi.org/10.1145/3690712.3690723). Proceedings of the Third Workshop on Intelligent and Interactive Writing Assistants 2024 *(LLMs as Writing Assistants)*

<a id="ref-108"></a>**[108]** Florian Weber, Thiemo Wambsganss, Seyed Parsa Neshaei, Matthias Soellner. [LegalWriter: An Intelligent Writing Support System for Structured and Persuasive Legal Case Writing for Novice Law Students](https://doi.org/10.1145/3613904.3642743). Proceedings of the 2024 CHI Conference on Human Factors in Computing Systems (CHI '24) 2024 *(LegalWriter)*

<a id="ref-109"></a>**[109]** Simon Wilbers, Johanna Gröpler, Bastian Prell, Jörg Reiff-Stephan. [Overall Writing Effectiveness: Exploring Students' Use of LLMs, Pushing the Limits of Automated Text Generation](https://doi.org/10.1007/978-3-031-61905-2_2). Smart Technologies for a Sustainable Future 2024 *(Overall Writing Effectiveness)*

<a id="ref-110"></a>**[110]** Lindy Woodrow. [College English writing affect: Self-efficacy and anxiety](https://doi.org/10.1016/j.system.2011.10.017). System 2011 *(College English Writing Affect)*

<a id="ref-111"></a>**[111]** Anqi Yang, Lisa McDonnell. [Student definitions of ownership and perceived ways ownership influences writing in a biology laboratory class](https://doi.org/10.1128/jmbe.00197-23). Journal of Microbiology & Biology Education 2024 *(Student Definitions of Ownership)*

<a id="ref-112"></a>**[112]** J.D. Zamfirescu-Pereira, Richmond Y. Wong, Bjoern Hartmann, Qian Yang. [Why Johnny Can't Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts](https://doi.org/10.1145/3544548.3581388). Proceedings of the 2023 CHI Conference on Human Factors in 22. Computing Systems (CHI '23) 2023 *(Why Johnny Can't Prompt)*

<a id="ref-113"></a>**[113]** Zijie Zeng, Shiqi Liu, Lele Sha, Zhuang Li, Kaixun Yang, Sannyuya Liu, Dragan Gašević, Guanliang Chen. [Detecting ai-generated sentences in humanai collaborative hybrid texts: Challenges, strategies, and insights](https://arxiv.org/abs/2403.03506). arXiv preprint arXiv:2403.03506 2024 *(Detecting AI-Generated Sentences)*

# A Appendix

## A.1 Pre-study Survey

## What gender do you identify as?

- Male
- Female
- Non-Binary
- Prefer not to disclose
- Other:

## How old are you?

- 18-24
- 25-34
- 35-44
- 45-55
- 55-64
- 65+

## What race/ethnicity describes you?

- American Indian or Alaskan Native
- Asian/Pacific Islander
- Black or African American
- Hispanic
- White/Caucasian
- Other:

[Self Efficacy in Writing] Please answer the following statements with a 7-point Likert scale:

- (1) I can think of many ideas for my writing
- (2) I can transform my ideas into written text
- (3) I can think of many words to describe my ideas
- (4) I can come up with many new ideas
- (5) I know exactly how to organize my ideas into my writing
- (6) I can spell my words correctly
- (7) I can write complete sentences
- (8) I can punctuate correctly, i.e., put punctuation marks such as full stops and commas in my sentences
- (9) I can write grammatically correct sentences
- (10) I can begin my paragraphs in the right spots
- (11) I can focus on my writing for at least one hour
- (12) I can ignore distractions while I'm writing
- (13) I can start writing assignments quickly
- (14) I can control my frustration while I'm writing
- (15) I can think of my writing goals before I write
- (16) I can keep writing even when it's difficult

## How often do you use ChatGPT for writing tasks?

- Never
- Once in a while
- About half the time
- Most of the time
- Always

[TAM] For the following, please answer based on your usage of ChatGPT (7-point Likert scale):

- (1) Using ChatGPT would enable me to accomplish writing tasks more quickly
- (2) Using ChatGPT increases my performance in writing tasks
- (3) Using ChatGPT increases my productivity in writing tasks
- (4) Using ChatGPT would enhance my effectiveness in writing tasks
- (5) ChatGPT makes writing tasks easier for me
- (6) I have found ChatGPT useful in writing tasks
- (7) Learning to use ChatGPT would be easy for me
- (8) I fi nd it easy to get ChatGPT to do what I want it to do
- (9) My interactions with ChatGPT are clear and understandable
- (10) I fi nd ChatGPT fl exible to interact with
- (11) It would be easy for me to become skillful at using ChatGPT
- (12) I fi nd ChatGPT easy to use

For the following, please answer based on your usage of ChatGPT (7-point Likert scale):

- (1) I leverage the advanced features of ChatGPT to achieve my goals more efficiently than other students
- (2) I'm often interested in trying new features
- (3) I maximize the capabilities of ChatGPT

What is the highest degree or level of school you have completed or are currently pursuing?

- No schooling completed
- Some high school, no diploma
- High school graduate, diploma or equivalent (e.g., GED)
- Some college credit, no degree
- Trade/technical/vocational training
- Associate degree
- Bachelor's degree
- Master's degree
- Professional degree
- Doctorate degree

## Have you completed the degree specified above?

- Yes
- No

What is your current major?

## A.2 Writing Prompt

We will describe an issue and provide three different perspectives on the issue. You are asked to read and consider the issue and perspectives, state your own perspective on the issue, and analyze the relationship between your perspective and at least one other perspective on the issue.

## Issue:

Automation is generally seen as a sign of progress, but what is lost when we replace humans with machines?

## Intelligent Machines

Many of the goods and services we depend on daily are now supplied by intelligent, automated machines rather than human beings. Robots build cars and other goods on assembly lines, where once there were human workers. Many of our phone conversations are now conducted not with people but with sophisticated technologies. We can now buy goods at a variety of stores without the help of a human cashier. Automation is generally seen as a sign of progress, but what is lost when we replace humans with machines? Given the accelerating variety and prevalence of intelligent machines, it is worth examining the implications and meaning of their presence in our lives.

## Perspective One (Dystopian view)

What we lose with the replacement of people by machines is some part of our own humanity. Even our mundane daily encounters no longer require from us basic courtesy, respect, and tolerance for other people.

Perspective Two (Utilitarian view) Machines are good at low-skill, repetitive jobs, and at high-speed, extremely precise jobs. In both cases they work better than humans. This efficiency leads to a more prosperous and progressive world for everyone.

Perspective Three (Progressive view) Intelligent machines challenge our long-standing ideas about what humans are or can be. This is good because it pushes both humans and machines toward new, unimagined possibilities.

## A.3 Exit Survey

Thank you for participating in our study. Please answer the following questions as part of our exit survey.

For the following questions, please answer based on your perceived ownership of the essay: 7-point Likert Scale

- (1) I feel that this is my essay
- (2) I feel that this essay belongs to me
- (3) I feel a high degree of ownership towards this essay
- (4) I feel the need to protect my ideas from being used by others.
- (5) I feel that this essays success is my success
- (6) I feel this essay was written by me
- (7) I feel the need to protect the ideas written in the essay
- (8) I do not feel like anyone else wrote this essay.

For the following questions, please answer based on your usage of ChatGPT: 7-point Likert Scale

- (1) I feel like ChatGPT helped me in the creation process of my writing
- (2) I feel like ChatGPT helped me with proofreading my essay
- (3) I feel like ChatGPT made my essay better
- (4) I liked using ChatGPT as an assistant during my essay writing
- (5) My writing would have been better without ChatGPT assistance

Thank you for completing our survey. Winners of the essay writing competition will receive an email after the study is complete.

![Figure 12](images/figure-12.png)

> **Figure 12:** K-means clustering SSE and Cluster information


# Footnotes

<a id="fn-1"></a>**1.** Note that these observed metrics have limitations and cannot fully capture users' cognitive and behavioral processes. For example, if a participant writes words manually, we cannot determine whether those words were generated from their own memory and knowledge or derived from a ChatGPT response and rephrased in their own way. In such cases, the words are categorized as user-added, since they were typed rather than copy-pasted (depicted as a gray dotted line passing through the participant in Figure 4-(1)).
