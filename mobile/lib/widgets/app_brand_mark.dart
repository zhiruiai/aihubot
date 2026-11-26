import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

class AppBrandMark extends StatelessWidget {
  const AppBrandMark({super.key, this.size = 64});

  final double size;

  @override
  Widget build(BuildContext context) => SvgPicture.asset(
    'assets/branding/icon.svg',
    width: size,
    height: size,
    excludeFromSemantics: true,
  );
}
