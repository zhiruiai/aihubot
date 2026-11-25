import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openbot_mobile/features/bot_library/library_screen.dart';
import 'package:openbot_mobile/features/bot_library/library_navigation.dart';
import 'package:openbot_mobile/features/bot_library/original_bot_template_data.dart';
import 'package:openbot_mobile/features/bots/create_screen.dart';
import 'library_support.dart';
import 'library_widget_support.dart';
import 'support.dart';
import 'widgets_test.dart' show testApp;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await Future.wait([
      loadOriginalBotTemplates('zh'),
      loadOriginalBotTemplates('en'),
    ]);
  });
  testWidgets(
    'bundled originals provide all localized profiles with foundational skills',
    (tester) async {
      final catalogs = await tester.runAsync(
        () => Future.wait([
          loadOriginalBotTemplates('zh'),
          loadOriginalBotTemplates('en'),
        ]),
      );
      expect(catalogs, isNotNull);
      for (final catalog in catalogs!) {
        expect(catalog.map((item) => item.id), [
          'research',
          'writing',
          'coordination',
          'engineering',
          'organization',
          'briefing',
          'support',
          'analysis',
          'recruitment',
          'skill-curator',
          'connector-builder',
          'engineering-lead',
          'frontend-designer',
          'feishu-assistant',
          'dingtalk-assistant',
          'wecom-assistant',
          'content-operations',
        ]);
        for (final item in catalog) {
          expect(item.profile.keys.toSet(), {
            'name',
            'role',
            'description',
            'instructions',
            'avatar',
            'color',
            'avatarImageId',
          });
          expect(item.profile['avatarImageId'], isNull);
          expect(item.skills.length, greaterThanOrEqualTo(4));
        }
      }
      expect(catalogs.first.first.profile['name'], '研究员');
      expect(catalogs.last.first.profile['name'], 'Researcher');
      for (var i = 0; i < catalogs.length; i++) {
        final content = catalogs[i].firstWhere(
          (template) => template.id == 'content-operations',
        );
        expect(content.starter, {
          'id': 'content-operations',
          'language': i == 0 ? 'zh-CN' : 'en',
        });
        expect(content.skills, [
          ...content.skills.take(4),
          i == 0 ? '内容运营' : 'Content operations',
          i == 0 ? '知乎技术文章' : 'Zhihu technical article',
        ]);
      }
      expect(
        filterOriginalBotTemplates(
          catalogs.last,
          'CODE verification',
          'Engineering',
        ).single.id,
        'engineering',
      );
      expect(
        filterOriginalBotTemplates(
          catalogs.first,
          '',
          '企业协作',
        ).map((template) => template.id),
        ['feishu-assistant', 'dingtalk-assistant', 'wecom-assistant'],
      );
    },
  );

  testWidgets(
    'original Bot template previews and edits locally before confirmed creation',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final server = LibraryServer();
      final writes = <Map<String, dynamic>>[];
      final f = await fixture((request) async {
        if (!request.url.path.endsWith('/creation-requests')) {
          return server.handle(request);
        }
        final payload = jsonDecode(request.body) as Map<String, dynamic>;
        writes.add(payload);
        final agent = {
          'id': 'new-bot',
          ...payload['profile'] as Map<String, dynamic>,
        };
        final chat = {
          'id': 'new-chat',
          'agentIds': ['new-bot'],
          'isGroup': false,
        };
        server.snapshot = {
          ...server.snapshot,
          'agents': [agent],
          'conversations': [chat],
        };
        return jsonResponse({
          'requestId': payload['requestId'],
          'kind': 'bot',
          'status': 'created',
          'workspaceId': 'space-a',
          'userId': 'user-a',
          'conversationId': 'new-chat',
          'agentIds': ['new-bot'],
          'conversation': chat,
          'agents': [agent],
        });
      });
      LibraryOpen? opened;
      await tester.pumpWidget(
        testApp(
          Builder(
            builder: (context) => Scaffold(
              body: FilledButton(
                onPressed: () async {
                  opened = await Navigator.push<LibraryOpen>(
                    context,
                    MaterialPageRoute(
                      builder: (_) => BotLibraryScreen(scope: f.scope),
                    ),
                  );
                },
                child: const Text('Open fixture'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open fixture'));
      await waitForLibrary(
        tester,
        () => find.text('aihubot originals').evaluate().isNotEmpty,
      );
      await tester.tap(find.text('aihubot originals'));
      final search = find.widgetWithText(
        TextField,
        'Search original templates',
      );
      await waitForLibrary(tester, () => search.evaluate().isNotEmpty);
      await tester.enterText(search, 'CONTENT operations');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Content Operations and Publishing'));
      await tester.pumpAndSettle();
      expect(
        find.text('Campaign planning, article delivery, and Zhihu publishing'),
        findsOneWidget,
      );
      expect(find.widgetWithText(Chip, 'Content operations'), findsOneWidget);
      expect(
        find.widgetWithText(Chip, 'Zhihu technical article'),
        findsOneWidget,
      );
      expect(writes, isEmpty);
      final use = find.text('Use template and edit');
      await tester.ensureVisible(use);
      await tester.tap(use);
      await waitForLibrary(
        tester,
        () => find.byType(CreateScreen).evaluate().isNotEmpty,
      );
      final name = find.widgetWithText(TextFormField, 'Name');
      await tester.enterText(name, 'Team Content Editor');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      expect(writes, isEmpty);
      final create = find.widgetWithText(FilledButton, 'Create');
      final scrollable = find
          .descendant(
            of: find.byType(CreateScreen),
            matching: find.byType(Scrollable),
          )
          .first;
      final scroll = tester.state<ScrollableState>(scrollable).position;
      for (var step = 0; step < 3 && create.evaluate().isEmpty; step++) {
        scroll.jumpTo(scroll.maxScrollExtent);
        await tester.pumpAndSettle();
      }
      await tester.ensureVisible(create);
      await tester.tap(create);
      await waitForLibrary(tester, () => opened != null);
      expect(writes.single['starter'], {
        'id': 'content-operations',
        'language': 'en',
      });
      expect(writes.single['profile']['name'], 'Team Content Editor');
      expect(writes.single['profile']['avatar'], 'spark');
      expect(writes.single['profile']['color'], '#187f9a');
      expect(
        writes.single['profile']['role'],
        'Campaign planning, article delivery, and Zhihu publishing',
      );
      expect(
        writes.single['profile']['instructions'],
        startsWith('You are my content operations editor'),
      );
      expect(opened?.conversationId, 'new-chat');
      await tester.pumpWidget(const SizedBox());
      f.scope.dispose();
      f.session.dispose();
    },
  );
  testWidgets('New Bot keeps edited fields until a template replaces them', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final server = LibraryServer();
    final writes = <Map<String, dynamic>>[];
    final f = await fixture((request) async {
      if (request.method == 'POST' &&
          request.url.path.endsWith('/creation-requests')) {
        writes.add(jsonDecode(request.body) as Map<String, dynamic>);
        return jsonResponse({
          'error': 'Synthetic unconfirmed request',
        }, status: 503);
      }
      return server.handle(request);
    });
    await tester.pumpWidget(testApp(CreateScreen(scope: f.scope, kind: 'bot')));
    final browse = find.widgetWithText(OutlinedButton, 'Start from a template');
    await waitForLibrary(
      tester,
      () => tester.widget<OutlinedButton>(browse).onPressed != null,
    );
    final name = find.widgetWithText(TextFormField, 'Name');
    await tester.enterText(name, 'My draft');
    Future<void> selectCoding() async {
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tester.ensureVisible(browse);
      await tester.tap(browse);
      final search = find.widgetWithText(
        TextField,
        'Search original templates',
      );
      await waitForLibrary(tester, () => search.evaluate().isNotEmpty);
      await tester.enterText(search, 'Coding Assistant');
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ListTile, 'Coding Assistant'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Use template and edit'));
      await tester.pumpAndSettle();
      expect(
        find.text('Replace your unsaved profile edits with this template?'),
        findsOneWidget,
      );
    }

    await selectCoding();
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('My draft'), findsOneWidget);
    await selectCoding();
    await tester.tap(find.text('Done'));
    // Replacing the form also reloads the Bot's model picker through the mock API.
    await waitForLibrary(
      tester,
      () =>
          name.evaluate().isNotEmpty &&
          tester.widget<TextFormField>(name).initialValue ==
              'Coding Assistant' &&
          find.byType(LinearProgressIndicator).evaluate().isEmpty,
    );
    expect(find.text('My draft'), findsNothing);
    expect(find.text('Coding Assistant'), findsOneWidget);
    expect(tester.widget<TextFormField>(name).enabled, isTrue);
    expect(
      server.requests.where((request) => request.method != 'GET'),
      isEmpty,
    );
    await tester.enterText(name, 'Edited Coding Assistant');
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    final scroll = tester
        .state<ScrollableState>(
          find
              .descendant(
                of: find.byType(CreateScreen),
                matching: find.byType(Scrollable),
              )
              .first,
        )
        .position;
    scroll.jumpTo(scroll.maxScrollExtent);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'Create'));
    await tester.tap(find.widgetWithText(FilledButton, 'Create'));
    await waitForLibrary(tester, () => writes.length == 1);
    expect(writes.single['starter'], {'id': 'engineering', 'language': 'en'});
    expect(writes.single['profile']['name'], 'Edited Coding Assistant');
    scroll.jumpTo(0);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Try again'));
    await waitForLibrary(tester, () => writes.length == 2);
    expect(writes.last, writes.first);
    await tester.pumpWidget(const SizedBox());
    f.scope.dispose();
    f.session.dispose();
  });
}
