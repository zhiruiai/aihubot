import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> waitForLibrary(WidgetTester tester, bool Function() ready) async {
  // Mock responses and route transitions can finish on different event loops.
  for (var attempt = 0; attempt < 200; attempt++) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 5)),
    );
    await tester.pump(const Duration(milliseconds: 16));
    if (ready() && !tester.binding.hasScheduledFrame) return;
  }
  expect(ready(), isTrue, reason: 'Expected library state did not appear.');
  expect(tester.binding.hasScheduledFrame, isFalse);
}

Future<void> libraryReach(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(
    finder,
    180,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
}
